import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createEmptyTaskResponseDetectorHook } from "../../src/hooks/empty-task-response-detector"

//#given: a fake plugin input (the hook ignores ctx) and the after-hook
function makeAfter() {
  const hook = createEmptyTaskResponseDetectorHook({} as unknown as PluginInput)
  return hook["tool.execute.after"]
}

type AfterInput = { tool: string; sessionID?: string; callID?: string }
type AfterOutput = { title: string; output: string; metadata: unknown }

async function runAfter(tool: string, outputText: string): Promise<AfterOutput> {
  //#when: the tool.execute.after hook fires for a completed call
  const after = makeAfter()
  const input: AfterInput = { tool, sessionID: "ses-test", callID: "call-1" }
  const output: AfterOutput = { title: "task", output: outputText, metadata: {} }
  await after(input, output)
  return output
}

describe("empty-task-response-detector actionable warning", () => {
  test("empty task output names the load_skills requirement", async () => {
    //#then: the replacement tells the orchestrator load_skills is REQUIRED
    const out = await runAfter("task", "")
    expect(out.output).toContain("load_skills")
  })

  test("empty task output names the category/subagent_type contract", async () => {
    //#then: the replacement tells the orchestrator EITHER category OR subagent_type
    const out = await runAfter("task", "   ")
    expect(out.output).toContain("subagent_type")
  })

  test("empty task output names the source tdd-enforcer rule", async () => {
    //#then: the replacement names tdd-enforcer for category source
    const out = await runAfter("Task", "")
    expect(out.output).toContain("tdd-enforcer")
  })

  test("empty task output warns against nested execute calls", async () => {
    //#then: the replacement advises top-level delegation instead of nested execute
    const out = await runAfter("task", "")
    expect(out.output).toContain("top-level")
  })

  test("non-empty task output passes through untouched", async () => {
    //#then: real results are never rewritten
    const out = await runAfter("task", "Task completed in 3s.\n\nAgent: mouse")
    expect(out.output).toBe("Task completed in 3s.\n\nAgent: mouse")
  })

  test("empty output from other tools is untouched", async () => {
    //#then: the hook only watches task/Task
    const out = await runAfter("read", "")
    expect(out.output).toBe("")
  })
})
