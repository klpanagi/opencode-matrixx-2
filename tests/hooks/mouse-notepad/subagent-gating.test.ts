import { beforeEach, describe, expect, test } from "bun:test"
import { createMouseNotepadHook } from "../../../src/hooks/mouse-notepad/hook"
import { _resetForTesting, setSessionAgent } from "../../../src/features/session-state/state"
import type { NativePluginContext } from "../../../src/shared/session/session-context-source"

function createMockContext() {
  return {
    client: {
      tui: {
        showToast: async () => {},
      },
    },
  } as unknown as NativePluginContext
}

describe("mouse-notepad delegation gating", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("injects the notepad directive for the native `subagent` tool", async () => {
    //#given an orchestrator session and a subagent call
    const sessionID = "notepad-subagent-session"
    setSessionAgent(sessionID, "niobe")
    const hook = createMouseNotepadHook(createMockContext())
    const output = { args: { prompt: "implement the feature" } as Record<string, unknown> }

    //#when the before-hook runs
    await hook["tool.execute.before"]({ tool: "subagent", sessionID, callID: "c1" }, output)

    //#then the notepad directive is prepended to the child prompt
    expect(output.args.prompt).toContain("NOTEPAD PATH")
    expect(output.args.prompt).toContain("implement the feature")
  })

  test("still injects for the legacy `task` alias", async () => {
    //#given an orchestrator session invoking the V1 tool name
    const sessionID = "notepad-task-alias-session"
    setSessionAgent(sessionID, "niobe")
    const hook = createMouseNotepadHook(createMockContext())
    const output = { args: { prompt: "legacy call" } as Record<string, unknown> }

    //#when the before-hook runs
    await hook["tool.execute.before"]({ tool: "task", sessionID, callID: "c2" }, output)

    //#then the directive is still injected
    expect(output.args.prompt).toContain("NOTEPAD PATH")
  })

  test("ignores unrelated tools", async () => {
    //#given an orchestrator session and a non-delegation tool
    const sessionID = "notepad-other-tool-session"
    setSessionAgent(sessionID, "niobe")
    const hook = createMouseNotepadHook(createMockContext())
    const output = { args: { prompt: "read this" } as Record<string, unknown> }

    //#when the before-hook runs on a different tool
    await hook["tool.execute.before"]({ tool: "read", sessionID, callID: "c3" }, output)

    //#then the prompt is untouched
    expect(output.args.prompt).toBe("read this")
  })
})
