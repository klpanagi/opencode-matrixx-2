/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import type { MatrixxConfig } from "../../../src/config"
import {
  BLOCK_MESSAGE_GREP_GLOB,
  WEBFETCH_BLOCK_MESSAGE,
} from "../../../src/hooks/context-mode-enforcer/constants"
import { createContextModeEnforcerHook } from "../../../src/hooks/context-mode-enforcer/hook"
import {
  _resetContextModeEnforcementForTesting,
  _setCtxToolsForTesting,
  _setDisciplinePathForTesting,
  hasWorkingSubstitute,
} from "../../../src/shared/context-mode-enforcement"

//#given: the ctx-absent fixture — discipline AGENTS.md resolves (override
//#given: bypasses existsSync, mirroring a repo where the discipline file is
//#given: present), enforce:true, default blocked_tools [grep, glob, webfetch].
//#given: No ctx_* tool (ctx_batch_execute / ctx_search / ctx_execute /
//#given: ctx_fetch_and_index) is registered in this unit-test process — the
//#given: hook (hook.ts:102,122) never consults tool presence, it gates ONLY on
//#given: `enforce && hasWorkingSubstitute()`, and hasWorkingSubstitute()
//#given: (context-mode-enforcement.ts:179-181) checks ONLY the discipline path.
//#given: T4 fix hook: add a ctx-tool presence check and fail-open (warn-only)
//#given: when ctx tools are absent; block only when a ctx substitute is real.
const DISCIPLINE_PRESENT = "/nonexistent-fake/AGENTS.md"

let seq = 0

function makeConfig(contextMode: unknown): MatrixxConfig {
  return { context_mode: contextMode } as unknown as MatrixxConfig
}

function runHook(contextMode: unknown, tool: string, args: Record<string, unknown> = {}) {
  // Guidance advisories fire at most once per session, so each run needs a fresh id.
  const sessionID = `ses_ctxabsent_${++seq}`
  rmSync(resolve(tmpdir(), `matrixx-ctx-guidance-s-${sessionID}`), { recursive: true, force: true })
  const hook = createContextModeEnforcerHook(makeConfig(contextMode))
  const output: { args: Record<string, unknown>; message?: string } = { args }
  const promise = hook["tool.execute.before"](
    { tool, sessionID } as never,
    output as never,
  )
  return { promise, output, sessionID }
}

afterEach(() => {
  _resetContextModeEnforcementForTesting()
})

describe("ctx-absent blocked loop (RED: fail-open when ctx tools absent)", () => {
  test("fixture sanity: discipline override makes hasWorkingSubstitute() true", () => {
    //#given: discipline file present, enforce on
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    //#when: the substitute check runs
    //#then: true — the block path in hook.ts:102,122 is armed (this anchors the RED tests below)
    expect(hasWorkingSubstitute()).toBe(true)
  })

  test("grep fail-opens with warn-only when ctx tools are absent", async () => {
    //#given: enforce:true + discipline present + NO ctx_* tool registered
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    const { promise, output } = runHook({ enforce: true }, "grep", { pattern: "foo" })
    //#when: grep runs with no working ctx substitute available to the agent
    //#then: soft warning, never throws — fail-open so the agent is not stranded
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("glob fail-opens with warn-only when ctx tools are absent", async () => {
    //#given: enforce:true + discipline present + NO ctx_* tool registered
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    const { promise, output } = runHook({ enforce: true }, "glob", { pattern: "**/*.ts" })
    //#when: glob runs with no working ctx substitute available to the agent
    //#then: soft warning, never throws — fail-open so the agent is not stranded
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("webfetch fail-opens with warn-only when ctx tools are absent", async () => {
    //#given: enforce:true + discipline present + NO ctx_* tool registered
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    const { promise, output } = runHook({ enforce: true }, "webfetch", { url: "https://example.com" })
    //#when: webfetch runs with no working ctx substitute available to the agent
    //#then: soft warning, never throws — fail-open so the agent is not stranded
    await expect(promise).resolves.toBeUndefined()
    expect(output.message).toBeDefined()
  })

  test("retry loop: repeated grep attempts resolve instead of throwing", async () => {
    //#given: enforce:true + discipline present + NO ctx_* tool registered, one session
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    const sessionID = `ses_ctxabsent_loop_${++seq}`
    rmSync(resolve(tmpdir(), `matrixx-ctx-guidance-s-${sessionID}`), { recursive: true, force: true })
    //#when: the agent retries grep 3 times (BLOCKED-loop replay — the error text
    //#when: names ctx_search/ctx_batch_execute, but no such tool exists here)
    //#then: every attempt resolves with guidance — no throw, no stranded loop
    for (let attempt = 0; attempt < 3; attempt++) {
      const hook = createContextModeEnforcerHook(makeConfig({ enforce: true }))
      const output: { args: Record<string, unknown>; message?: string } = { args: { pattern: "foo" } }
      const promise = hook["tool.execute.before"](
        { tool: "grep", sessionID } as never,
        output as never,
      )
      await expect(promise).resolves.toBeUndefined()
    }
    // Sanity: the current code throws BLOCK_MESSAGE_GREP_GLOB on each attempt.
    expect(BLOCK_MESSAGE_GREP_GLOB).toContain("ctx_search")
  })

  test("negative: ctx present still blocks grep under enforce", async () => {
    _setDisciplinePathForTesting(DISCIPLINE_PRESENT)
    _setCtxToolsForTesting(true)
    const { promise } = runHook({ enforce: true }, "grep", { pattern: "foo" })
    await expect(promise).rejects.toThrow("ctx_search")
  })
})
