/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createSubagentBlockHook } from "../../../src/hooks/subagent-block/hook"

describe("subagent-block hook", () => {
  const mockCtx = {} as Parameters<typeof createSubagentBlockHook>[0]

  test("blocks generic subagent tool call with task redirect", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx)
    const output: { args: Record<string, unknown>; message?: string } = { args: {} }

    //#when
    const act = () =>
      hook["tool.execute.before"](
        { tool: "subagent", sessionID: "test", callID: "1" },
        output
      )

    //#then
    await expect(act()).rejects.toThrow(/task/)
  })

  test("allowlisted agent passes through without throw", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx, { allowlist: ["allowlisted-session"] })
    const output: { args: Record<string, unknown>; message?: string } = { args: {} }

    //#when
    await hook["tool.execute.before"](
      { tool: "subagent", sessionID: "allowlisted-session", callID: "1" },
      output
    )

    //#then
    expect(output.args).toEqual({})
  })

  test("non-subagent tool passes through without throw", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx)
    const output: { args: Record<string, unknown>; message?: string } = {
      args: { filePath: "README.md" },
    }

    //#when
    await hook["tool.execute.before"](
      { tool: "read", sessionID: "test", callID: "1" },
      output
    )

    //#then
    expect(output.args).toEqual({ filePath: "README.md" })
  })
})
