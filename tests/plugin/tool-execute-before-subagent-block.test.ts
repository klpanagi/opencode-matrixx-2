/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createToolExecuteBeforeHandler } from "../../src/plugin/tool-execute-before"

describe("global native subagent ban", () => {
  test("throws redirect naming task for tool=subagent", async () => {
    //#given
    const ctx = { session: { context: async () => [] } } as never
    const handler = createToolExecuteBeforeHandler({ ctx, hooks: {} as never })
    const input = { tool: "subagent", sessionID: "ses_1", callID: "c1" }
    const output = { args: { prompt: "do the thing" } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).rejects.toThrow(/task.*categor|subagent_type/i)
  })

  test("throws redirect for uppercase SubAgent variant", async () => {
    //#given
    const ctx = { session: { context: async () => [] } } as never
    const handler = createToolExecuteBeforeHandler({ ctx, hooks: {} as never })
    const input = { tool: " SubAgent ", sessionID: "ses_1", callID: "c2" }
    const output = { args: { prompt: "do other thing" } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).rejects.toThrow(/native subagent/i)
  })
})
