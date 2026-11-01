/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createBackgroundCancel } from "../../../src/tools/background-task/create-background-cancel"

const testContext = {
  sessionID: "ses_parent",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function makeTool(opts?: {
  bgTask?: unknown
  sesTask?: unknown
  messages?: unknown
}) {
  const interrupt = mock(() => Promise.resolve(undefined))
  const mockManager = {
    getTask: mock(() => undefined),
    findBySession: mock(() => opts?.sesTask),
    findDiskTaskBySession: mock(() => undefined),
    getKnownSessionIds: mock(() => new Set(["ses_live"])),
    cancelTask: mock(() =>
      Promise.resolve(opts?.bgTask !== undefined),
    ),
    getAllDescendantTasks: mock(() => []),
    native: {
      session: {
        messages: mock(() => Promise.resolve(opts?.messages ?? [{ id: "m1" }])),
        get: mock(() => Promise.resolve(opts?.messages ?? [{ id: "m1" }])),
        list: mock(() => Promise.resolve([])),
        interrupt,
      },
    },
  } as unknown as BackgroundManager
  const mockClient = {
    session: {
      context: mock(() => Promise.resolve({ messages: [] })),
      interrupt,
    },
  } as unknown as Parameters<typeof createBackgroundCancel>[1]
  if (opts?.bgTask !== undefined) {
    ;(mockManager.getTask as ReturnType<typeof mock>).mockImplementation(() => opts.bgTask)
  }
  const tool = createBackgroundCancel(mockManager, mockClient)
  return { tool, mockManager, mockClient, interrupt }
}

describe("createBackgroundCancel ses_ path", () => {
  test("cancels live native ses_ via session interrupt", async () => {
    //#given
    const { tool, interrupt } = makeTool()

    //#when
    const result = await tool.execute({ taskId: "ses_live" }, testContext)

    //#then
    expect(interrupt).toHaveBeenCalled()
    expect(String(result)).toContain("ses_live")
    expect(String(result)).not.toContain("bg_-only")
  })

  test("bg_ cancel path still aborts via manager cancelTask", async () => {
    //#given
    const bgTask = {
      id: "bg_123",
      sessionID: "ses_child",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "bg work",
      prompt: "do work",
      agent: "mouse",
      status: "running",
    }
    const { tool, mockManager } = makeTool({ bgTask })

    //#when
    const result = await tool.execute({ taskId: "bg_123" }, testContext)

    //#then
    expect(mockManager.cancelTask).toHaveBeenCalled()
    expect(String(result)).toContain("bg_123")
  })

  test("unknown id still returns not_found error", async () => {
    //#given
    const { tool } = makeTool({ messages: null })

    //#when
    const result = await tool.execute({ taskId: "bg_ghost" }, testContext)

    //#then
    expect(String(result)).toContain("[ERROR]")
    expect(String(result)).toContain("bg_ghost")
  })
})
