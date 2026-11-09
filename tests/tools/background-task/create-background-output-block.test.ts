/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createBackgroundOutput } from "../../../src/tools/background-task/create-background-output"
import { MAX_BACKGROUND_OUTPUT_CHARS } from "../../../src/tools/background-task/constants"

const baseCtx = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: mock(() => {}),
  callID: "test-call",
}

const mockClient = {
  session: {
    context: mock(() => Promise.resolve({ messages: [] })),
  },
} as unknown as MatrixxContext["client"]

function makeTask(
  id: string,
  status: string,
  options?: { compactedResult?: string },
): Record<string, unknown> {
  return {
    id,
    sessionID: `sess-${id}`,
    parentSessionID: "test-session",
    parentMessageID: "test-message",
    description: `Task ${id}`,
    agent: "mouse",
    category: "source",
    prompt: "do stuff",
    status,
    startedAt: new Date(),
    ...(status === "completed" ? { completedAt: new Date() } : {}),
    ...(options?.compactedResult !== undefined ? { compactedResult: options.compactedResult } : {}),
  }
}

/** Manager whose settle wait resolves only when the returned notifier fires. */
function makeWakeableManager(
  getId: () => string,
  getStatus: () => string,
): { manager: BackgroundManager; notify: () => void } {
  let pending: (() => void) | undefined
  const manager = {
    getTask: mock(() => makeTask(getId(), getStatus(), { compactedResult: "woke output" })),
    waitForTaskSettled: mock(
      () =>
        new Promise<void>((resolve) => {
          pending = resolve
        }),
    ),
  } as unknown as BackgroundManager
  return {
    manager,
    notify: () => {
      const wake = pending
      pending = undefined
      wake?.()
    },
  }
}

/** Manager whose settle wait falls back to a real timer (the 1s floor). */
function makeFloorManager(
  getId: () => string,
  getStatus: () => string,
  result?: string,
): BackgroundManager {
  return {
    getTask: mock(() => makeTask(getId(), getStatus(), { compactedResult: result })),
    waitForTaskSettled: mock(
      (_taskId: string, timeoutMs: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeoutMs)
        }),
    ),
  } as unknown as BackgroundManager
}

describe("createBackgroundOutput block", () => {
  test("A: completed entry returns terminal outcome, no timeout footer", async () => {
    //#given - native event already completed the task in the Map (D5)
    const task = makeTask("task-a", "completed", { compactedResult: "done output" })
    const manager = {
      getTask: mock(() => task),
    } as unknown as BackgroundManager
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-a", block: true, timeout: 1500, full_session: false },
      baseCtx,
    )
    //#then
    expect(result).not.toContain("Timed out")
    expect(result).toContain("done output")
  })

  test("B: no reconcile, stays running -> Timed out", async () => {
    //#given a task that never leaves running; the settle wait only times out
    const manager = makeFloorManager(() => "task-b", () => "running")
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-b", block: true, timeout: 1500, full_session: false },
      baseCtx,
    )
    //#then
    expect(result).toContain("Timed out")
  })

  test("event-wake: a settle notification returns well under the 1s floor", async () => {
    //#given a running task that turns terminal 50ms after the call starts
    let status = "running"
    const { manager, notify } = makeWakeableManager(() => "task-wake", () => status)
    const tool = createBackgroundOutput(manager, mockClient)
    const flip = setTimeout(() => {
      status = "completed"
      notify()
    }, 50)
    try {
      //#when
      const started = Date.now()
      const result = await tool.execute(
        { task_id: "task-wake", block: true, timeout: 5000, full_session: false },
        baseCtx,
      )
      const elapsed = Date.now() - started
      //#then completes in the settle tick, not the 1s floor
      expect(elapsed).toBeLessThan(900)
      expect(result).toContain("woke output")
      expect(result).not.toContain("Timed out")
    } finally {
      clearTimeout(flip)
    }
  })

  test("1s-floor: status change mid-wait is re-checked at the floor tick", async () => {
    //#given a task that reports running until 1.1s, while the settle wait only times out
    const startedAt = Date.now()
    const manager = makeFloorManager(
      () => "task-floor",
      () => (Date.now() - startedAt >= 1100 ? "completed" : "running"),
      "floor output",
    )
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-floor", block: true, timeout: 1500, full_session: false },
      baseCtx,
    )
    const elapsed = Date.now() - startedAt
    //#then the completed status is picked up by the final floor tick, before the deadline
    expect(elapsed).toBeLessThan(1700)
    expect(result).toContain("floor output")
    expect(result).not.toContain("Timed out")
  })

  test("abort mid-block returns promptly without throwing", async () => {
    //#given a blocking call that is aborted 30ms in
    const controller = new AbortController()
    const manager = {
      getTask: mock(() => makeTask("task-abort", "running")),
      waitForTaskSettled: mock(
        (_taskId: string, timeoutMs: number, signal?: AbortSignal) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeoutMs)
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer)
                resolve()
              },
              { once: true },
            )
          }),
      ),
    } as unknown as BackgroundManager
    const tool = createBackgroundOutput(manager, mockClient)
    setTimeout(() => controller.abort(), 30)
    //#when
    const started = Date.now()
    const result = await tool.execute(
      { task_id: "task-abort", block: true, timeout: 5000, full_session: false },
      { ...baseCtx, abort: controller.signal },
    )
    const elapsed = Date.now() - started
    //#then returns a string promptly, no error envelope
    expect(typeof result).toBe("string")
    expect(result).not.toContain("Error getting output")
    expect(elapsed).toBeLessThan(500)
  })

  test("oversized output is truncated with the context-mode marker", async () => {
    //#given a completed result larger than the output budget
    const oversized = "x".repeat(MAX_BACKGROUND_OUTPUT_CHARS + 5000)
    const manager = {
      getTask: mock(() => makeTask("task-big", "completed", { compactedResult: oversized })),
    } as unknown as BackgroundManager
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-big", block: false, full_session: false },
      baseCtx,
    )
    //#then bounded and marked
    expect(result.length).toBeLessThan(MAX_BACKGROUND_OUTPUT_CHARS + 200)
    expect(result).toContain("output truncated to")
  })

  test("small output is returned verbatim", async () => {
    //#given a completed result well within the budget
    const manager = {
      getTask: mock(() =>
        makeTask("task-small", "completed", { compactedResult: "small done output" }),
      ),
    } as unknown as BackgroundManager
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-small", block: false, full_session: false },
      baseCtx,
    )
    //#then unchanged
    expect(result).toContain("small done output")
    expect(result).not.toContain("output truncated")
  })
})
