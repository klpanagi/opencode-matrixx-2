/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createSubagentBlockHook } from "../../../src/hooks/subagent-block/hook"

describe("subagent-block allowlist bypass for named agent", () => {
  const mockCtx = {} as Parameters<typeof createSubagentBlockHook>[0]

  test("allowlisted agent name in args passes through without throw", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx, { allowlist: ["sentinel"] })
    const output: { args: Record<string, unknown>; message?: string } = {
      args: { agent: "sentinel" },
    }

    //#when
    await hook["tool.execute.before"](
      { tool: "subagent", sessionID: "ses_abc123", callID: "1" },
      output,
    )

    //#then
    expect(output.args).toEqual({ agent: "sentinel" })
  })

  test("allowlisted subagent_type in args passes through without throw", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx, {
      allowlist: ["my-helper"],
    })
    const output: { args: Record<string, unknown>; message?: string } = {
      args: { subagent_type: "my-helper" },
    }

    //#when
    await hook["tool.execute.before"](
      { tool: "subagent", sessionID: "ses_xyz", callID: "2" },
      output,
    )

    //#then
    expect(output.args).toEqual({ subagent_type: "my-helper" })
  })

  test("non-allowlisted agent passes through (coexistence cutover)", async () => {
    //#given
    const hook = createSubagentBlockHook(mockCtx, { allowlist: ["sentinel"] })
    const output: { args: Record<string, unknown>; message?: string } = {
      args: { agent: "other-agent" },
    }

    //#when
    await hook["tool.execute.before"](
      { tool: "subagent", sessionID: "ses_other", callID: "3" },
      output,
    )

    //#then
    expect(output.args).toEqual({ agent: "other-agent" })
  })
})
