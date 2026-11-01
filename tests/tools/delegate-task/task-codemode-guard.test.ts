import { describe, expect, test } from "bun:test"
import { createDelegateTask } from "../../../src/tools/delegate-task/tools"

function makeOptions() {
  return {
    manager: {} as never,
    client: {} as never,
    directory: "/tmp/x",
  }
}

describe("task codemode guard (B)", () => {
  test("definition carries codemode:false direct-only option", () => {
    //#given the delegate-task tool factory
    //#when created
    const def = createDelegateTask(makeOptions())
    //#then it is marked direct-only so the host keeps it out of the code-mode catalog
    expect((def as { options?: unknown }).options).toEqual({ codemode: false })
  })

  test("execute without tool session context fails closed with explicit error", async () => {
    //#given a task call with no top-level tool session (code-mode invocation)
    const def = createDelegateTask(makeOptions())
    //#when executed without sessionID/messageID
    const result = await def.execute(
      { description: "x", prompt: "y", load_skills: [], category: "blue-pill" } as never,
      { sessionID: "", messageID: "" } as never,
    )
    //#then it returns an explicit error instead of an empty string
    const text = typeof result === "string" ? result : String((result as { output?: unknown }).output ?? "")
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toMatch(/code-mode|top-level|direct/i)
  })
})
