import { describe, expect, test } from "bun:test"
import { createEmptyTaskResponseDetectorHook } from "../../src/hooks/empty-task-response-detector"
import { DIAGNOSTIC_CAUSES } from "../../src/tools/delegate-task/diagnostic-shape"

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
  test("diagnostic causes point at log and code-mode", () => {
    //#given the shared diagnostic causes string
    //#when inspected
    //#then it classifies causes and points at the log
    expect(DIAGNOSTIC_CAUSES).toContain("code-mode")
    expect(DIAGNOSTIC_CAUSES).toContain("/tmp/matrixx.log")
  })
})
