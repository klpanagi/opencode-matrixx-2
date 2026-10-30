/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MatrixxContext } from "../../src/plugin/context"
import { createJsonErrorRecoveryHook } from "../../src/hooks/json-error-recovery/hook"

function makeHook() {
  return createJsonErrorRecoveryHook({} as unknown as MatrixxContext)
}

async function run(tool: string, outputText: string) {
  const hook = makeHook()
  const output = { title: "", output: outputText, metadata: {} }
  await hook["tool.execute.after"](
    { tool, sessionID: "ses_1", callID: "c1" },
    output as never,
  )
  return output.output
}

const JSON_ERR = "Error: json parse error at position 0"

describe("json-error-recovery shell alias (V2)", () => {
  test("shell stays excluded like bash (no spurious reminder)", async () => {
    //#given: a shell JSON error
    //#when: the recovery hook runs
    const out = await run("shell", JSON_ERR)
    //#then: no reminder appended — shell is an excluded tool
    expect(out).not.toContain("IMMEDIATE ACTION REQUIRED")
  })

  test("bash stays excluded (V1 compat)", async () => {
    //#given: a bash JSON error
    //#when: the recovery hook runs
    const out = await run("bash", JSON_ERR)
    //#then: no reminder appended
    expect(out).not.toContain("IMMEDIATE ACTION REQUIRED")
  })

  test("non-excluded tools still get the reminder", async () => {
    //#given: a task JSON error
    //#when: the recovery hook runs
    const out = await run("task", JSON_ERR)
    //#then: the reminder is appended
    expect(out).toContain("IMMEDIATE ACTION REQUIRED")
  })
})
