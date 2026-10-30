import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { emitToolInfo } from "../../src/tools/shared/define-tool"

// The delegate-task tool spawns a nested agent, which the host cannot do from
// inside a code-mode execute block: the call returns an empty string. It must
// therefore be exposed as a direct-only tool so the agent reaches it from the
// top level, where the spawn has a real tool session context.

const definition = {
  description: "delegate",
  args: { prompt: z.string() },
  execute: async () => "ok",
}

const deps = { directory: "/tmp/x", worktree: "/tmp/x" }

describe("emitToolInfo registration options", () => {
  test("marks the delegate-task tool as direct-only", () => {
    //#given the task tool definition
    //#when translated for the V2 tool registry
    const tool = emitToolInfo("task", definition, deps)
    //#then registration options keep it out of the code-mode catalog
    expect(tool?.options).toEqual({ codemode: false })
  })

  test("leaves every other tool in the code-mode catalog", () => {
    //#given a non-delegate tool definition
    //#when translated for the V2 tool registry
    const tool = emitToolInfo("read", definition, deps)
    //#then no registration options are attached
    expect(tool?.options).toBeUndefined()
  })

  test("only the task tool carries registration options", () => {
    //#given the exported registration option map
    //#when inspected
    const names = ["task", "read", "skill", "grep", "glob"]
    const withOptions = names.filter((name) => emitToolInfo(name, definition, deps)?.options !== undefined)
    //#then exactly one tool is direct-only
    expect(withOptions).toEqual(["task"])
  })
})
