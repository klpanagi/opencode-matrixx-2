/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

const stagedSpy = mock(() => Promise.resolve({ available: false, findings: [] }))
const prePushSpy = mock(() => Promise.resolve({ available: false, findings: [] }))

mock.module("../../../src/hooks/secret-leak-guard/gitleaks-runner", () => ({
  runGitleaksStagedScan: stagedSpy,
  runGitleaksPrePushScan: prePushSpy,
}))

import { createSecretLeakGuardHook } from "../../../src/hooks/secret-leak-guard/hook"

function makeHook() {
  return createSecretLeakGuardHook({ directory: "/tmp" } as unknown as PluginInput)
}

async function run(tool: string, command: string) {
  stagedSpy.mockClear()
  prePushSpy.mockClear()
  const hook = makeHook()
  const output = { args: { command } }
  await hook["tool.execute.before"](
    { tool, sessionID: "ses_1", callID: "c1" },
    output as never,
  )
}

describe("secret-leak-guard shell alias (V2)", () => {
  test("shell git commit reaches the scanner like bash", async () => {
    //#given: a shell git commit
    //#when: the guard runs
    await run("shell", "git commit -m 'feat: x'")
    //#then: the staged scan ran (gate did not swallow the shell tool)
    expect(stagedSpy).toHaveBeenCalled()
  })

  test("bash git commit still reaches the scanner", async () => {
    //#given: a bash git commit (V1 compat)
    //#when: the guard runs
    await run("bash", "git commit -m 'feat: x'")
    //#then: the staged scan ran
    expect(stagedSpy).toHaveBeenCalled()
  })

  test("non-shell tools never reach the scanner", async () => {
    //#given: a read tool call
    //#when: the guard runs
    await run("read", "git commit -m 'feat: x'")
    //#then: no scan ran
    expect(stagedSpy).not.toHaveBeenCalled()
    expect(prePushSpy).not.toHaveBeenCalled()
  })
})
