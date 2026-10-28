/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import type { MatrixxConfig } from "../../../src/config"
import { BLOCK_MESSAGE_GREP_GLOB } from "../../../src/hooks/context-mode-enforcer/constants"
import { createContextModeEnforcerHook } from "../../../src/hooks/context-mode-enforcer/hook"
import { _setDisciplinePathForTesting } from "../../../src/shared/context-mode-enforcement"

const FAKE_PATH = "/nonexistent-fake/AGENTS.md"

let seq = 0

function makeConfig(contextMode: unknown): MatrixxConfig {
  return { context_mode: contextMode } as unknown as MatrixxConfig
}

function runHook(contextMode: unknown, tool: string, args: Record<string, unknown> = {}) {
  // Guidance advisories fire at most once per session, so each test needs its own.
  const sessionID = `ses_legacy_${++seq}`
  rmSync(resolve(tmpdir(), `matrixx-ctx-guidance-s-${sessionID}`), { recursive: true, force: true })
  const hook = createContextModeEnforcerHook(makeConfig(contextMode))
  const output: { args: Record<string, unknown>; message?: string } = { args }
  const promise = hook["tool.execute.before"](
    { tool, sessionID } as never,
    output as never,
  )
  return { promise, output }
}

describe("context-mode-enforcer hook", () => {
  test("block message names the working substitute", () => {
    //#given: the block message
    //#when: inspected
    //#then: points at ctx_batch_execute/ctx_execute + rg, never a grep/glob fallback
    expect(BLOCK_MESSAGE_GREP_GLOB).toContain("ctx_batch_execute")
    expect(BLOCK_MESSAGE_GREP_GLOB).toContain("ctx_execute")
    expect(BLOCK_MESSAGE_GREP_GLOB).toContain("rg")
    expect(BLOCK_MESSAGE_GREP_GLOB).not.toContain("grep/glob fallback")
  })

  test("blocks grep when enforced with a working substitute", async () => {
    //#given: enforce on, substitute taught
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise } = runHook({ enforce: true }, "grep")
    //#when: grep runs
    //#then: throws naming the substitute
    await expect(promise).rejects.toThrow("ctx_batch_execute")
  })

  test("warns instead of blocking when no substitute exists", async () => {
    //#given: enforce on, nothing indexed
    _setDisciplinePathForTesting(null)
    const { promise, output } = runHook({ enforce: true }, "grep")
    //#when: grep runs
    //#then: soft warning, no throw — the agent is never stranded
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("warns on grep when enforce is off", async () => {
    //#given: warn-only mode
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enforce: false }, "grep")
    //#when: grep runs
    //#then: soft warning, no throw
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("lets grep through when not in blocked_tools", async () => {
    //#given: grep not gated
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enforce: true, blocked_tools: ["glob"] }, "grep")
    //#when: grep runs
    //#then: untouched
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeUndefined()
  })

  test("read is warn-only even under enforce", async () => {
    //#given: read gated, enforce on
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enforce: true, blocked_tools: ["read", "grep"] }, "read")
    //#when: read runs
    //#then: warns, never throws
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("bash grep warns when bash is not gated", async () => {
    //#given: enforce on, bash not in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enforce: true }, "bash", { command: "grep -r foo src" })
    //#when: bash grep runs
    //#then: warns, never throws
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("no-op when context_mode disabled", async () => {
    //#given: disabled
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enabled: false, enforce: true }, "grep")
    //#when: grep runs
    //#then: untouched
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeUndefined()
  })

  test("rtk cat triggers the bash file-read path (soft warn)", async () => {
    //#given: warn-only mode, bash not gated
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runHook({ enforce: false }, "bash", { command: "rtk cat some/file" })
    //#when: rtk cat runs
    //#then: soft file-read warning, no throw
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("rtk cat throws when enforce on with bash gated", async () => {
    //#given: enforce on, bash in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise } = runHook({ enforce: true, blocked_tools: ["bash", "grep"] }, "bash", { command: "rtk cat some/file" })
    //#when: rtk cat runs
    //#then: throws the grep/glob block message
    await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
  })

  test("rtk head and rtk tail are detected as file reads", async () => {
    //#given: enforce on, bash gated
    _setDisciplinePathForTesting(FAKE_PATH)
    //#when: rtk head / rtk tail run
    //#then: both throw the grep/glob block message
    for (const cmd of ["rtk head some/file", "rtk tail some/file"]) {
      const { promise } = runHook({ enforce: true, blocked_tools: ["bash", "grep"] }, "bash", { command: cmd })
      await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
    }
  })

  test("rtk grep throws under enforce with bash gated", async () => {
    //#given: enforce on, bash in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise } = runHook({ enforce: true, blocked_tools: ["bash", "grep"] }, "bash", { command: "rtk grep foo" })
    //#when: rtk grep runs
    //#then: throws, same as bare grep
    await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
  })

  test("bash file-read block still throws when substitute missing", async () => {
    //#given: enforce on, bash gated, but no working substitute
    _setDisciplinePathForTesting(null)
    const { promise } = runHook({ enforce: true, blocked_tools: ["bash", "grep"] }, "bash", { command: "rtk cat some/file" })
    //#when: rtk cat runs
    //#then: still throws — the bash file-read block does NOT require a substitute
    await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
    _setDisciplinePathForTesting(undefined)
  })
})

describe("context-mode-enforcer hook: shell alias (V2)", () => {
  function runShell(contextMode: unknown, command: string) {
    const sessionID = `ses_shell_${++seq}`
    rmSync(resolve(tmpdir(), `matrixx-ctx-guidance-s-${sessionID}`), { recursive: true, force: true })
    const hook = createContextModeEnforcerHook(makeConfig(contextMode))
    const output: { args: Record<string, unknown>; message?: string } = { args: { command } }
    const promise = hook["tool.execute.before"](
      { tool: "shell", sessionID } as never,
      output as never,
    )
    return { promise, output }
  }

  test("live-bug replay: shell cat blocked when bash is gated", async () => {
    //#given: enforce on with V1 bash spelling in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise } = runShell({ enforce: true, blocked_tools: ["bash", "grep"] }, "cat package.json")
    //#when: shell runs a file-read command
    //#then: throws the grep/glob block message (same as bash did)
    await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
  })

  test("shell rtk cat throws when only shell is gated", async () => {
    //#given: enforce on with V2 shell spelling in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise } = runShell({ enforce: true, blocked_tools: ["shell", "grep"] }, "rtk cat some/file")
    //#when: shell runs a file-read command
    //#then: throws the grep/glob block message
    await expect(promise).rejects.toThrow(BLOCK_MESSAGE_GREP_GLOB)
    _setDisciplinePathForTesting(undefined)
  })

  test("shell grep warns when neither spelling is gated", async () => {
    //#given: enforce on, shell not in blocked_tools
    _setDisciplinePathForTesting(FAKE_PATH)
    const { promise, output } = runShell({ enforce: true }, "grep -r foo src")
    //#when: shell grep runs
    //#then: warns, never throws
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })
})
