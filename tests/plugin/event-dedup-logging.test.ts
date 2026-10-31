/// <reference types="bun-types" />
import { beforeEach, describe, expect, mock, test } from "bun:test"

type LogCall = { message: string; data?: unknown }

const logCalls: LogCall[] = []
mock.module("../../src/shared/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data })
  },
  warn: () => {},
}))

import type { MatrixxConfig } from "../../src/config"
import type { V2Event } from "../../src/plugin/context"
import { createEventHandler } from "../../src/plugin/event"
import type { DomainHooks, DomainManagers } from "../../src/plugin/setup-domains"

function buildHandler(onIdle: (event: V2Event) => void | Promise<void>) {
  return createEventHandler({
    ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {
      tmuxSessionManager: {
        onSessionCreated: async () => {},
        onSessionDeleted: async () => {},
      },
    } as unknown as DomainManagers,
    hooks: {
      autoUpdateChecker: { event: onIdle },
      backgroundNotificationHook: { event: async () => {} },
      sessionNotification: async () => {},
      unstableAgentBabysitter: { event: async () => {} },
      contextWindowMonitor: { event: async () => {} },
      directoryAgentsInjector: { event: async () => {} },
      rulesInjector: { event: async () => {} },
      thinkMode: { event: async () => {} },
      contextWindowLimitRecovery: { event: async () => {} },
      agentUsageReminder: { event: async () => {} },
      categorySkillReminder: { event: async () => {} },
      interactiveBashSession: { event: async () => {} },
      matrixLoop: { event: async () => {} },
      stopContinuationGuard: { event: async () => {} },
      niobeHook: { handler: async () => {} },
    } as unknown as DomainHooks,
  })
}

function findDedupLogs(decision: "kept" | "dropped"): Array<{ message: string; data: Record<string, unknown> }> {
  return logCalls
    .filter((call) => call.message.includes("dedup") && call.message.includes(decision))
    .map((call) => ({ message: call.message, data: (call.data ?? {}) as Record<string, unknown> }))
}

describe("createEventHandler - session.idle dedup logging", () => {
  beforeEach(() => {
    logCalls.length = 0
  })

  test("rapid double idle drops the second event but logs the drop with window-ms remaining", async () => {
    //#given
    const dispatched: V2Event[] = []
    const handler = buildHandler((event) => {
      if (event.type === "session.idle") dispatched.push(event)
    })
    const sessionID = "ses_dedup_drop_red"

    //#when - synthetic idle first (kept), then the real idle arrives inside the window
    await handler({ type: "session.status", data: { sessionID, status: { type: "idle" } } })
    await handler({ type: "session.idle", data: { sessionID } })

    //#then - dedup behavior unchanged: only the synthetic idle is dispatched
    expect(dispatched.length).toBe(1)

    //#then - the drop is visible in the log with sessionID and window-ms remaining
    const dropped = findDedupLogs("dropped").filter((entry) => entry.data.sessionID === sessionID)
    expect(dropped.length).toBe(1)
    expect(dropped[0].data.sessionID).toBe(sessionID)
    expect(typeof dropped[0].data.timestamp).toBe("string")
    expect(typeof dropped[0].data.windowMsRemaining).toBe("number")
    expect(dropped[0].data.windowMsRemaining as number).toBeGreaterThan(0)
    expect(typeof dropped[0].data.dedup_dropped_total).toBe("number")
  })

  test("kept idle path is logged with sessionID and timestamp", async () => {
    //#given
    const dispatched: V2Event[] = []
    const handler = buildHandler((event) => {
      if (event.type === "session.idle") dispatched.push(event)
    })
    const sessionID = "ses_dedup_kept_red"

    //#when - a single real idle arrives with no prior synthetic idle
    await handler({ type: "session.idle", data: { sessionID } })

    //#then - dispatched once and the kept decision is logged
    expect(dispatched.length).toBe(1)
    const kept = findDedupLogs("kept").filter((entry) => entry.data.sessionID === sessionID)
    expect(kept.length).toBe(1)
    expect(kept[0].data.sessionID).toBe(sessionID)
    expect(typeof kept[0].data.timestamp).toBe("string")
  })

  test("dropped log correlates taskId when the event carries one", async () => {
    //#given
    const dispatched: V2Event[] = []
    const handler = buildHandler((event) => {
      if (event.type === "session.idle") dispatched.push(event)
    })
    const sessionID = "ses_dedup_taskid_red"

    //#when - synthetic idle first, then a real idle carrying a taskId inside the window
    await handler({ type: "session.status", data: { sessionID, status: { type: "idle" } } })
    await handler({ type: "session.idle", data: { sessionID, taskId: "T-abc123" } })

    //#then - dropped and the log line carries the taskId correlation
    expect(dispatched.length).toBe(1)
    const dropped = findDedupLogs("dropped").filter((entry) => entry.data.sessionID === sessionID)
    expect(dropped.length).toBe(1)
    expect(dropped[0].data.taskId).toBe("T-abc123")
  })

  test("dedup_dropped_total counter increments on every drop", async () => {
    //#given
    const dispatched: V2Event[] = []
    const handler = buildHandler((event) => {
      if (event.type === "session.idle") dispatched.push(event)
    })

    //#when - two independent rapid double idles on different sessions
    await handler({ type: "session.status", data: { sessionID: "ses_dedup_cnt_a", status: { type: "idle" } } })
    await handler({ type: "session.idle", data: { sessionID: "ses_dedup_cnt_a" } })
    await handler({ type: "session.status", data: { sessionID: "ses_dedup_cnt_b", status: { type: "idle" } } })
    await handler({ type: "session.idle", data: { sessionID: "ses_dedup_cnt_b" } })

    //#then - both seconds dropped and the counter grew between drops
    expect(dispatched.length).toBe(2)
    const first = findDedupLogs("dropped").find((entry) => entry.data.sessionID === "ses_dedup_cnt_a")
    const second = findDedupLogs("dropped").find((entry) => entry.data.sessionID === "ses_dedup_cnt_b")
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second?.data.dedup_dropped_total as number).toBeGreaterThan(
      first?.data.dedup_dropped_total as number,
    )
  })
})
