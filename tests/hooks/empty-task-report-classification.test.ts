import { describe, expect, test } from "bun:test"
import { createEmptyTaskResponseDetectorHook } from "../../src/hooks/empty-task-response-detector"

describe("empty report classification", () => {
  test("detector warning classifies three causes with fixes", async () => {
    //#given an empty task output
    const hook = createEmptyTaskResponseDetectorHook({} as never)
    const output = { title: "t", output: "   ", metadata: {} }
    //#when the after-hook runs
    await (hook as Record<string, Function>)["tool.execute.after"]({ tool: "task", sessionID: "s", callID: "c" }, output)
    //#then the warning names code-mode, permission-denied delegation, and empty model output
    expect(output.output).toContain("Code-mode delegation")
    expect(output.output).toContain("Permission-denied")
    expect(output.output).toContain("Empty model output")
    expect(output.output).toContain("/tmp/matrixx.log")
  })
})
