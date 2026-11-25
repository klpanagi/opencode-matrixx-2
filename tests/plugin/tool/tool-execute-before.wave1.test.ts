/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createToolExecuteBeforeHandler } from "../../../src/plugin/tool/tool-execute-before"

type CreatedHooks = Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"]
type HandlerCtx = Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"]

function createCtx(): HandlerCtx {
  return { session: { context: async () => [] } } as unknown as HandlerCtx
}

describe("tool.execute.before — Wave 1 settled fan-out", () => {
  test("a rejecting Wave-1 hook does not cancel its siblings or the tool call", async () => {
    //#given — the first Wave-1 hook rejects, the remaining three record that they ran
    const ran: string[] = []
    const hooks = {
      qualityGate: {
        "tool.execute.before": async () => {
          ran.push("qualityGate")
          throw new Error("qualityGate exploded")
        },
      },
      commentChecker: {
        "tool.execute.before": async () => {
          ran.push("commentChecker")
        },
      },
      directoryAgentsInjector: {
        "tool.execute.before": async () => {
          ran.push("directoryAgentsInjector")
        },
      },
      rulesInjector: {
        "tool.execute.before": async () => {
          ran.push("rulesInjector")
        },
      },
    } as unknown as CreatedHooks

    const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })
    const input = { tool: "read", sessionID: "ses_wave1", callID: "call_wave1" }
    const output = { args: { filePath: "src/index.ts" } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then — the rejection was absorbed, and hooks 3 and 4 still ran
    await expect(run).resolves.toBeUndefined()
    expect(ran).toContain("commentChecker")
    expect(ran).toContain("directoryAgentsInjector")
    expect(ran).toContain("rulesInjector")
  })

  test("a rejecting Wave-2 blocking guard still aborts the tool call", async () => {
    //#given — Wave 2 must stay fail-fast after the Wave-1 conversion
    const hooks = {
      secretLeakGuard: {
        "tool.execute.before": async () => {
          throw new Error("blocked by guard")
        },
      },
    } as unknown as CreatedHooks

    const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })
    const input = { tool: "edit", sessionID: "ses_wave2", callID: "call_wave2" }
    const output = { args: {} as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).rejects.toThrow("blocked by guard")
  })
})
