/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createToolExecuteBeforeHandler } from "../../src/plugin/tool-execute-before"

describe("native subagent coexistence", () => {
  test("does not block tool=subagent (native stays available)", async () => {
    //#given
    const ctx = { session: { context: async () => [] } } as never
    const handler = createToolExecuteBeforeHandler({ ctx, hooks: {} as never })
    const input = { tool: "subagent", sessionID: "ses_1", callID: "c1" }
    const output = { args: { prompt: "do the thing" } as Record<string, unknown> }

    //#when
    await handler(input, output)

    //#then
    expect(output.args).toEqual({ prompt: "do the thing" })
  })

  test("does not block repeat subagent call", async () => {
    //#given
    const ctx = { session: { context: async () => [] } } as never
    const handler = createToolExecuteBeforeHandler({ ctx, hooks: {} as never })
    const input = { tool: "subagent", sessionID: "ses_1", callID: "c2" }
    const output = { args: { prompt: "do other thing" } as Record<string, unknown> }

    //#when
    await handler(input, output)

    //#then
    expect(output.args).toEqual({ prompt: "do other thing" })
  })
})
