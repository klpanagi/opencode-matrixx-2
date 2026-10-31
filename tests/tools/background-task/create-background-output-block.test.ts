/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
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
} as any

describe("createBackgroundOutput block", () => {
  test("A: reconcile flips running->completed, no timeout", async () => {
    //#given
    const task: any = {
      id: "task-a",
      sessionID: "sess-a",
      description: "Task A",
      agent: "mouse",
      category: "source",
      prompt: "do stuff",
      status: "running",
      startedAt: new Date(),
      completedAt: new Date(),
      compactedResult: "done output",
    }
    const reconcileMock = mock(async () => {
      task.status = "completed"
    })
    const manager: any = {
      getTask: mock(() => task),
      reconcile: reconcileMock,
    }
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute({ task_id: "task-a", block: true, timeout: 1500 } as any, baseCtx as any)
    //#then
    expect(reconcileMock).toHaveBeenCalled()
    expect(result).not.toContain("Timed out")
  })

  test("B: no reconcile, stays running -> Timed out", async () => {
    //#given
    const task: any = {
      id: "task-b",
      sessionID: "sess-b",
      description: "Task B",
      agent: "mouse",
      prompt: "do stuff",
      status: "running",
      startedAt: new Date(),
    }
    const manager: any = {
      getTask: mock(() => task),
    }
    const tool = createBackgroundOutput(manager, mockClient)
    //#when
    const result = await tool.execute(
      { task_id: "task-b", block: true, timeout: 1500, full_session: false } as any,
      baseCtx as any
    )
    //#then
    expect(result).toContain("Timed out")
  })
})
