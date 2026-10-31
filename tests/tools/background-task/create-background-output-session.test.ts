/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createBackgroundOutput } from "../../../src/tools/background-task/create-background-output"

const testContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function makeTool(getTaskImpl: () => unknown, findBySessionImpl?: (id: string) => unknown) {
  const mockManager = {
    getTask: mock(getTaskImpl),
    ...(findBySessionImpl ? { findBySession: mock(findBySessionImpl) } : {}),
  } as unknown as BackgroundManager
  const mockClient = {
    session: {
      context: mock(() => Promise.resolve({ messages: [] })),
    },
  } as unknown as MatrixxContext["client"]
  return createBackgroundOutput(mockManager, mockClient)
}

describe("createBackgroundOutput session_id lookup", () => {
  test("resolves task_id=sessionID via findBySession without creating handles", async () => {
    //#given
    const nativeTask = {
      id: "bg_nat",
      sessionID: "ses_nat",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "native-backed task",
      prompt: "do work",
      agent: "oracle",
      status: "cancelled",
    }
    const tool = makeTool(() => undefined, (id: string) =>
      id === "ses_nat" ? nativeTask : undefined,
    )
    //#when
    const result = await tool.execute({ task_id: "ses_nat" }, testContext)
    //#then
    expect(result).toContain("native-backed task")
    expect(result).not.toContain("Task not found")
  })

  test("unknown ses_ id without handle explains native read path", async () => {
    //#given
    const tool = makeTool(() => undefined, () => undefined)
    //#when
    const result = await tool.execute({ task_id: "ses_ghost" }, testContext)
    //#then
    expect(result).toContain("Task not found: ses_ghost")
    expect(result).toContain("bg_-only")
  })

  test("unknown non-ses id keeps the legacy message", async () => {
    //#given
    const tool = makeTool(() => undefined, () => undefined)
    //#when
    const result = await tool.execute({ task_id: "bg_ghost" }, testContext)
    //#then
    expect(result).toBe("Task not found: bg_ghost")
  })
})
