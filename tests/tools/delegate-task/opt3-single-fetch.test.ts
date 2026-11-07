/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { __setTimingConfig, __resetTimingConfig } from "../../../src/tools/delegate-task/timing"

const NON_TERMINAL_MESSAGES = [
  { type: "user", id: "m1", content: [{ type: "text", text: "hello" }] },
  { type: "assistant", id: "m2", content: [{ type: "text", text: "working" }] },
]

function mockCtx() {
  return {
    sessionID: "ses_parent",
    messageID: "msg_1",
    agent: "task",
    abort: { aborted: false },
  }
}

describe("Opt-3 single fetchSessionMessages", () => {
  beforeEach(() => {})
  afterEach(() => {
    __resetTimingConfig()
  })

  test("poller timeout path with prior loop result performs 1 fetch total", async () => {
    //#given
    __setTimingConfig({ POLL_INTERVAL_MS: 1000, MAX_POLL_TIME_MS: 50 })
    const { pollSyncSession } = await import("../../../src/tools/delegate-task/sync-session-poller")
    let calls = 0
    const client = {
      session: {
        context: async () => {
          calls++
          return { messages: NON_TERMINAL_MESSAGES }
        },
      },
    }

    //#when
    await pollSyncSession(mockCtx() as never, client as never, {
      sessionID: "ses_bench",
      agentToUse: "task",
      toastManager: null,
      taskId: undefined,
    })

    //#then
    expect(calls).toBe(1)
  })

  test("poller timeout path with NO prior result performs exactly 1 fetch", async () => {
    //#given — child-background guard skips every loop fetch, so the timeout
    // path is the only fetch
    __setTimingConfig({ POLL_INTERVAL_MS: 10, MAX_POLL_TIME_MS: 50 })
    const { pollSyncSession } = await import("../../../src/tools/delegate-task/sync-session-poller")
    let calls = 0
    const client = {
      session: {
        context: async () => {
          calls++
          return { messages: NON_TERMINAL_MESSAGES }
        },
      },
    }

    //#when
    await pollSyncSession(mockCtx() as never, client as never, {
      sessionID: "ses_bench",
      agentToUse: "task",
      toastManager: null,
      taskId: undefined,
      hasActiveChildBackgroundTasks: () => true,
    })

    //#then
    expect(calls).toBe(1)
  })

  test("unstable final result uses last polled messages (no extra fetch)", async () => {
    //#given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
    const { executeUnstableAgentTask } = await import("../../../src/tools/delegate-task/unstable-agent-task")
    let calls = 0
    const client = {
      session: { context: async () => { calls++; return { messages: NON_TERMINAL_MESSAGES } } },
      agent: { list: async () => [] },
      model: { list: async () => [] },
    }
    const runningTask = { id: "bg_bench", sessionID: "ses_bench", status: "running" }
    const executorCtx = {
      manager: { launch: async () => ({ ...runningTask }), getTask: () => ({ ...runningTask }) },
      client,
      directory: "/tmp",
    }

    //#when
    const result = await executeUnstableAgentTask(
      { description: "bench", prompt: "bench", run_in_background: false, load_skills: [] } as never,
      mockCtx() as never,
      executorCtx as never,
      { sessionID: "ses_parent", messageID: "msg_1" } as never,
      "task",
      undefined,
      undefined,
      "bench-model",
    )

    //#then
    expect(result).toContain("SUPERVISED TASK COMPLETED")
    expect(calls).toBe(2)
  })
})
