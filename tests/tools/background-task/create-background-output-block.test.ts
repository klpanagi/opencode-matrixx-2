/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createBackgroundOutput } from "../../../src/tools/background-task/create-background-output"

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

describe("createBackgroundOutput block", () => {
  test("A: completed entry returns terminal outcome, no timeout footer", async () => {
    //#given - native event already completed the task in the Map (D5)
    const task = {
      id: "task-a",
      sessionID: "sess-a",
      parentSessionID: "test-session",
      parentMessageID: "test-message",
      description: "Task A",
      agent: "mouse",
      category: "source",
      prompt: "do stuff",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      compactedResult: "done output",
    }
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
    //#given
    const task = {
      id: "task-b",
      sessionID: "sess-b",
      parentSessionID: "test-session",
      parentMessageID: "test-message",
      description: "Task B",
      agent: "mouse",
      prompt: "do stuff",
      status: "running",
      startedAt: new Date(),
    }
    const manager = {
      getTask: mock(() => task),
    } as unknown as BackgroundManager
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-b", block: true, timeout: 1500, full_session: false },
      baseCtx,
    )
    //#then
    expect(result).toContain("Timed out")
  })
})
