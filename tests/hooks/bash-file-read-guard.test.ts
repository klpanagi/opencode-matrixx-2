/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createBashFileReadGuardHook } from "../../src/hooks/bash-file-read-guard"

async function run(tool: string, command: string) {
  const hook = createBashFileReadGuardHook()
  const output: { args: Record<string, unknown>; message?: string } = { args: { command } }
  await hook["tool.execute.before"]?.(
    { tool, sessionID: "ses_1", callID: "c1" },
    output as never,
  )
  return output
}

describe("bash-file-read-guard shell alias (V2)", () => {
  test("shell cat warns like bash cat", async () => {
    //#given: a shell simple file read
    //#when: the guard runs
    const output = await run("shell", "cat notes.md")
    //#then: the Read-tool nudge is set
    expect(output.message).toContain("Read tool")
  })

  test("bash cat still warns (V1 compat)", async () => {
    //#given: a bash simple file read
    //#when: the guard runs
    const output = await run("bash", "cat notes.md")
    //#then: the Read-tool nudge is set
    expect(output.message).toContain("Read tool")
  })

  test("non-shell tools never warn", async () => {
    //#given: a read tool call
    //#when: the guard runs
    const output = await run("read", "cat notes.md")
    //#then: untouched
    expect(output.message).toBeUndefined()
  })
})
