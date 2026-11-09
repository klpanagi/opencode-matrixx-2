/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { SessionContextCarrier } from "../../../src/shared/session/session-context-source"
import { resetMessageCursor } from "../../../src/shared/session/session-cursor"
import { formatTaskResult } from "../../../src/tools/background-task/task-result-format"

const SHARED_SESSION_ID = "ses-shared-cursor"

function createTask(id: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id,
    sessionID: SHARED_SESSION_ID,
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

function clientReturning(messages: unknown[]): SessionContextCarrier {
  return { session: { context: async () => ({ messages }) } }
}

function assistantMessage(id: string, created: number, text: string) {
  return { id, type: "assistant", time: { created }, content: [{ type: "text", text }] }
}

const SESSION_MESSAGES = [
  assistantMessage("m1", 1000, "first output"),
  assistantMessage("m2", 2000, "second output"),
]

const NO_NEW_OUTPUT = "(No new output since last check)"

describe("formatTaskResult per-task cursor", () => {
  afterEach(() => {
    resetMessageCursor()
  })

  test("does not share one cursor between two tasks on the same session", async () => {
    //#given two different tasks that resolve to the same session id
    const taskA = createTask("bg_taskA")
    const taskB = createTask("bg_taskB")

    //#when task A is polled first and task B is polled afterwards with no prior cursor
    const firstForA = await formatTaskResult(taskA, clientReturning(SESSION_MESSAGES))
    const firstForB = await formatTaskResult(taskB, clientReturning(SESSION_MESSAGES))

    //#then A receives the full body and B still receives the full body, not an empty poll
    expect(firstForA).toContain("first output")
    expect(firstForA).toContain("second output")
    expect(firstForB).not.toContain(NO_NEW_OUTPUT)
    expect(firstForB).toContain("first output")
    expect(firstForB).toContain("second output")
  })

  test("still deduplicates repeated polls for the same task", async () => {
    //#given one task that has already been polled once
    const taskA = createTask("bg_taskRepeat")
    await formatTaskResult(taskA, clientReturning(SESSION_MESSAGES))

    //#when the same task is polled again without new messages
    const secondForA = await formatTaskResult(taskA, clientReturning(SESSION_MESSAGES))

    //#then the per-task cursor still reports no new output
    expect(secondForA).toContain(NO_NEW_OUTPUT)
    expect(secondForA).not.toContain("first output")
  })

  test("keeps a third task independent of the other two", async () => {
    //#given two tasks that have consumed their own cursors on the shared session
    const taskA = createTask("bg_taskIndA")
    const taskB = createTask("bg_taskIndB")
    await formatTaskResult(taskA, clientReturning(SESSION_MESSAGES))
    await formatTaskResult(taskB, clientReturning(SESSION_MESSAGES))

    //#when a third task on the same session is polled for the first time
    const taskC = createTask("bg_taskIndC")
    const firstForC = await formatTaskResult(taskC, clientReturning(SESSION_MESSAGES))

    //#then the third task sees the full body as well
    expect(firstForC).not.toContain(NO_NEW_OUTPUT)
    expect(firstForC).toContain("first output")
    expect(firstForC).toContain("second output")
  })
})
