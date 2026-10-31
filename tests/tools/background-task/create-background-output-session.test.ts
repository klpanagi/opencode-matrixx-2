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

  test("unknown non-ses id returns typed not_found with session_read hint", async () => {
    //#given
    const tool = makeTool(() => undefined, () => undefined)
    //#when
    const result = await tool.execute({ task_id: "bg_ghost" }, testContext)
    //#then
    expect(result).toBe("Task not found: bg_ghost. Inspect via session_read. Revive is bg_-only.")
  })

  test("session_id alias agreeing with task_id resolves without ambiguity", async () => {
    //#given a task_id and session_id that agree
    const nativeTask = {
      id: "bg_nat2",
      sessionID: "ses_nat2",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "native-backed task two",
      prompt: "do work",
      agent: "oracle",
      status: "cancelled",
    }
    const tool = makeTool(() => undefined, (id: string) =>
      id === "ses_nat2" ? nativeTask : undefined,
    )
    //#when both identifiers are supplied and agree
    const result = await tool.execute({ task_id: "ses_nat2", session_id: "ses_nat2" }, testContext)
    //#then the task resolves with no ambiguous_id error
    expect(result).toContain("native-backed task two")
    expect(result).not.toContain("ambiguous_id")
  })

  test("disagreeing task_id and session_id return ambiguous_id without guessing", async () => {
    //#given two identifiers that disagree
    const tool = makeTool(() => undefined, () => undefined)
    //#when both are supplied with different values
    const result = await tool.execute({ task_id: "bg_a", session_id: "ses_b" }, testContext)
    //#then the tool refuses with a typed ambiguous_id error
    expect(result).toContain("[ERROR] ambiguous_id")
    expect(result).toContain("bg_a")
    expect(result).toContain("ses_b")
  })
})
