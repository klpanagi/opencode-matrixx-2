/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test"
import { createSubagentControl } from "../../../src/tools/subagent-control/tools"

const testContext = {
  sessionID: "ses_parent",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function makeTool(opts?: {
  get?: (args: { sessionID: string }) => Promise<unknown>
  interrupt?: (args: { sessionID: string }) => Promise<unknown>
  wait?: (args: { sessionID: string }) => Promise<unknown>
}) {
  const get = mock(opts?.get ?? (async () => ({ id: "ses_child" })))
  const interrupt = mock(opts?.interrupt ?? (async () => undefined))
  const wait = mock(opts?.wait ?? (async () => undefined))
  const client = { session: { get, interrupt, wait } }
  const tool = createSubagentControl(client)
  return { tool, get, interrupt, wait }
}

describe("subagent_control cancel", () => {
  test("cancel interrupts the child session and points at session_read", async () => {
    //#given
    const { tool, interrupt } = makeTool()

    //#when
    const result = await tool.execute(
      { action: "cancel", session_id: "ses_child" },
      testContext,
    )

    //#then
    expect(interrupt).toHaveBeenCalled()
    expect(interrupt.mock.calls[0]?.[0]).toEqual({ sessionID: "ses_child" })
    expect(String(result)).toContain("ses_child")
    expect(String(result)).toContain("session_read")
  })

  test("double cancel returns a clean already-cancelled error without throwing", async () => {
    //#given
    const { tool, interrupt } = makeTool()
    await tool.execute({ action: "cancel", session_id: "ses_child" }, testContext)

    //#when
    const result = await tool.execute({ action: "cancel", session_id: "ses_child" }, testContext)

    //#then
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(String(result)).toContain("[ERROR]")
    expect(String(result)).toContain("already")
  })

  test("cancel on unknown session returns a clean error without throwing", async () => {
    //#given
    const { tool } = makeTool({
      interrupt: async () => {
        throw new Error("session not found: ses_nope")
      },
    })

    //#when
    const result = await tool.execute({ action: "cancel", session_id: "ses_nope" }, testContext)

    //#then
    expect(String(result)).toContain("[ERROR]")
  })

  test("empty session_id is a clean argument error", async () => {
    //#given
    const { tool, interrupt } = makeTool()

    //#when
    const result = await tool.execute({ action: "cancel", session_id: "  " }, testContext)

    //#then
    expect(interrupt).not.toHaveBeenCalled()
    expect(String(result)).toContain("[ERROR]")
  })
})

describe("subagent_control wait", () => {
  test("wait on an already-finished session returns immediately with a read pointer", async () => {
    //#given
    const { tool, wait } = makeTool()

    //#when
    const result = await tool.execute(
      { action: "wait", session_id: "ses_child", timeout: 5000 },
      testContext,
    )

    //#then
    expect(wait).toHaveBeenCalled()
    expect(String(result)).toContain("ses_child")
    expect(String(result)).toContain("session_read")
    expect(String(result)).not.toContain("still running")
  })

  test("wait timeout returns a clean still-running result without throwing", async () => {
    //#given
    const { tool } = makeTool({
      wait: () => new Promise<unknown>(() => {}),
    })

    //#when
    const result = await tool.execute(
      { action: "wait", session_id: "ses_child", timeout: 50 },
      testContext,
    )

    //#then
    expect(String(result)).toContain("still running")
    expect(String(result)).toContain("ses_child")
    expect(String(result)).not.toContain("[ERROR]")
  })

  test("wait on an unknown session returns a clean error without throwing", async () => {
    //#given
    const { tool } = makeTool({
      get: async () => {
        throw new Error("session not found: ses_nope")
      },
    })

    //#when
    const result = await tool.execute({ action: "wait", session_id: "ses_nope" }, testContext)

    //#then
    expect(String(result)).toContain("[ERROR]")
  })
})
