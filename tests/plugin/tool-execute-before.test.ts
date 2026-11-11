const { describe, expect, test } = require("bun:test")
const { createToolExecuteBeforeHandler } = require("../../src/plugin/tool/tool-execute-before")

describe("createToolExecuteBeforeHandler", () => {
  test("does not execute subagent question blocker hook for question tool", async () => {
    //#given
    const ctx = {
      session: {
        context: async () => [],
      },
    }

    const hooks = {
      subagentQuestionBlocker: {
        "tool.execute.before": async () => {
          throw new Error("subagentQuestionBlocker should not run")
        },
      },
    }

    const handler = createToolExecuteBeforeHandler({ ctx, hooks })
    const input = { tool: "question", sessionID: "ses_sub", callID: "call_1" }
    const output = { args: { questions: [] } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).resolves.toBeUndefined()
  })

  describe("task tool args pass through unnormalized (Phase 5 removal)", () => {
    // NOTE (Phase 5.3 inversion): the legacy task-normalization branch was
    // deleted — the `task` tool is a removed-tools guard stub now, so
    // tool.execute.before must not rewrite category/subagent_type/session_id.
    const emptyHooks = {}

    function createCtx() {
      return {
        session: {
          context: async () => [],
        },
      }
    }

    test("does not set subagent_type when category is provided", async () => {
      //#given
      const ctx = createCtx()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "bullet-time", description: "Test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBeUndefined()
      expect(output.args).toEqual({ category: "bullet-time", description: "Test" })
    })

    test("does not resolve subagent_type from session_id", async () => {
      //#given
      const ctx = createCtx()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { session_id: "ses_abc123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBeUndefined()
    })

    test("leaves explicit subagent_type untouched", async () => {
      //#given
      const ctx = createCtx()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { subagent_type: "oracle", description: "Oracle task" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("oracle")
    })

    test("passes native subagent through untouched", async () => {
      //#given native subagent is THE delegation path
      const ctx = createCtx()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "subagent", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "bullet-time", description: "Test delegation" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then passthrough, no task aliasing applied
      expect(output.args).toEqual({ category: "bullet-time", description: "Test delegation" })
    })

    test("does not modify args for non-task tools", async () => {
      //#given
      const ctx = createCtx()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "bash", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { command: "ls" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBeUndefined()
    })
  })

})
export {}
