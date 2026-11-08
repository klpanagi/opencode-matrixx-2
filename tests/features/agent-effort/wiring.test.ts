/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EffortConfig } from "../../../src/config/schema/effort"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

const CONFIG: EffortConfig = {
  enabled: true,
  report: ["parent"],
  weights: { compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 },
  prices: {
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheWritePer1k: 0.00375,
  },
  toolCosts: {},
  maxMessages: 200,
  maxBytes: 2_097_152,
  rollup: false,
}

function assistantMessage(): Record<string, unknown> {
  return {
    type: "assistant",
    info: {
      role: "assistant",
      tokens: {
        input: 10,
        output: 20,
        reasoning: 0,
        cache: { read: 3, write: 4 },
      },
    },
    content: [{ type: "tool", tool: "read" }],
  }
}

function buildRuntime(
  dir: string,
  promptCalls: Array<{ sessionID: string; text: string }>,
  contextImpl: ManagerRuntime["native"]["session"]["context"] = async () => [assistantMessage()],
  effortConfig: EffortConfig | undefined = CONFIG,
): ManagerRuntime {
  const store = new ManagerStore(dir)
  const native = {
    session: {
      prompt: async (args: { sessionID: string; text: string }) => {
        promptCalls.push({ sessionID: args.sessionID, text: args.text })
        return {}
      },
      interrupt: async () => ({}),
      context: contextImpl,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return {
    store,
    native: native as unknown as ManagerRuntime["native"],
    directory: dir,
    taskHistory: new TaskHistory(),
    effortConfig,
  }
}

function seedTask(
  store: ManagerStore,
  overrides: Partial<BackgroundTask> & { id: string },
): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "ses_parent_1",
    parentMessageID: "msg-1",
    description: "effort wiring task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    sessionID: "ses_child_1",
    startedAt: new Date(Date.now() - 12000),
    ...overrides,
  }
  store.tasks.set(task.id, task)
  return task
}

type TerminalCase = {
  eventType: string
  expectedStatus: "completed" | "error"
  data: Record<string, unknown>
}

const TERMINAL_CASES: TerminalCase[] = [
  {
    eventType: "session.idle",
    expectedStatus: "completed",
    data: { sessionID: "ses_child_1" },
  },
  {
    eventType: "session.execution.succeeded",
    expectedStatus: "completed",
    data: { sessionID: "ses_child_1" },
  },
  {
    eventType: "session.error",
    expectedStatus: "error",
    data: { sessionID: "ses_child_1", error: "boom" },
  },
  {
    eventType: "session.execution.failed",
    expectedStatus: "error",
    data: { sessionID: "ses_child_1", error: "boom" },
  },
]

describe("agent-effort wiring: background terminal branches", () => {
  let dir: string

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "effort-wiring-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  for (const terminal of TERMINAL_CASES) {
    test(`${terminal.eventType} records effort and delivers it to the parent`, async () => {
      //#given
      const promptCalls: Array<{ sessionID: string; text: string }> = []
      const rt = buildRuntime(dir, promptCalls)
      seedTask(rt.store, { id: `bg_${terminal.eventType.replace(/\./g, "_")}` })

      //#when
      await handleManagerEvent(rt, {
        type: terminal.eventType,
        data: terminal.data,
      } as unknown as Parameters<typeof handleManagerEvent>[1])

      //#then
      const task = rt.store.findBySession("ses_child_1")
      expect(task?.status).toBe(terminal.expectedStatus)
      expect(promptCalls.length).toBe(1)
      expect(promptCalls[0].sessionID).toBe("ses_parent_1")
      expect(promptCalls[0].text).toContain("⚡ effort")
    })
  }

  test("disabled effort config still delivers the parent notification without an effort line", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const rt = { ...buildRuntime(dir, promptCalls), effortConfig: undefined }
    seedTask(rt.store, { id: "bg_disabled" })

    //#when
    await handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: "ses_child_1" },
    } as unknown as Parameters<typeof handleManagerEvent>[1])

    //#then
    const task = rt.store.findBySession("ses_child_1")
    expect(task?.status).toBe("completed")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].text).toContain("background_output(task_id")
    expect(promptCalls[0].text).not.toContain("⚡ effort")
  })

  test("fails open when session.context rejects: parent still notified and task still completes", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const rt = buildRuntime(
      dir,
      promptCalls,
      async () => {
        throw new Error("context unavailable")
      },
      CONFIG,
    )
    seedTask(rt.store, { id: "bg_fail_open" })

    //#when
    await handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: "ses_child_1" },
    } as unknown as Parameters<typeof handleManagerEvent>[1])

    //#then
    const task = rt.store.findBySession("ses_child_1")
    expect(task?.status).toBe("completed")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].text).not.toContain("⚡ effort")
  })

  test("a second terminal event after session.idle is a no-op", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const rt = buildRuntime(dir, promptCalls)
    seedTask(rt.store, { id: "bg_settled" })

    //#when
    await handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: "ses_child_1" },
    } as unknown as Parameters<typeof handleManagerEvent>[1])
    await handleManagerEvent(rt, {
      type: "session.error",
      data: { sessionID: "ses_child_1", error: "late error" },
    } as unknown as Parameters<typeof handleManagerEvent>[1])

    //#then
    const task = rt.store.findBySession("ses_child_1")
    expect(task?.status).toBe("completed")
    expect(task?.error).toBeUndefined()
    expect(promptCalls.length).toBe(1)
  })
})
