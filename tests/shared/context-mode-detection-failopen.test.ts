/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  _resetContextModeEnforcementForTesting,
  _setCtxToolsForTesting,
  _setDisciplinePathForTesting,
  hasCtxToolsForPrompts,
  isCtxToolsAvailable,
  setContextModeForPrompts,
} from "../../src/shared/policy/context-mode-enforcement"
import {
  BASH_ROUTED_MESSAGE,
  BLOCK_MESSAGE_GREP_GLOB,
  WARN_MESSAGE_BASH_READ,
  WARN_MESSAGE_READ,
  WEBFETCH_BLOCK_MESSAGE,
} from "../../src/hooks/context-mode-enforcer/constants"

describe("context-mode fail-open detection (Phase 2)", () => {
  test("discipline present plus enabled config implies ctx tools available", () => {
    //#given: a resolvable discipline path and an enabled context_mode config
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting("/fake/AGENTS.md")
    setContextModeForPrompts({ enabled: true })
    //#when: availability checked
    const got = isCtxToolsAvailable()
    //#then: present — hook may block under enforce
    expect(got).toBe(true)
    expect(hasCtxToolsForPrompts()).toBe(true)
    _resetContextModeEnforcementForTesting()
  })

  test("discipline present without config stays fail-open (warn-only)", () => {
    //#given: discipline resolves but no context_mode config was ever set
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting("/fake/AGENTS.md")
    //#when: availability checked
    //#then: absent — mirrors the committed ctx-absent-blocked RED suite
    expect(isCtxToolsAvailable()).toBe(false)
    _resetContextModeEnforcementForTesting()
  })

  test("absent config and discipline fails open to warn-only", () => {
    //#given: nothing present and no override
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(null)
    //#when: availability checked
    //#then: documented default false — the hook warns, never strands the agent
    expect(isCtxToolsAvailable()).toBe(false)
    _resetContextModeEnforcementForTesting()
  })

  test("explicitly disabled config implies ctx tools unavailable", () => {
    //#given: discipline resolves but context_mode is disabled
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting("/fake/AGENTS.md")
    setContextModeForPrompts({ enabled: false })
    //#when: availability checked
    //#then: absent
    expect(isCtxToolsAvailable()).toBe(false)
    _resetContextModeEnforcementForTesting()
  })

  test("testing override seam still respected", () => {
    //#given: an explicit override
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting("/fake/AGENTS.md")
    _setCtxToolsForTesting(false)
    //#when: availability checked
    //#then: override wins
    expect(isCtxToolsAvailable()).toBe(false)
    _setCtxToolsForTesting(true)
    expect(isCtxToolsAvailable()).toBe(true)
    _resetContextModeEnforcementForTesting()
  })

  test("hook guidance texts name V2 tools only", () => {
    //#given: the enforcer message constants
    const all = [
      WARN_MESSAGE_READ,
      BLOCK_MESSAGE_GREP_GLOB,
      WARN_MESSAGE_BASH_READ,
      WEBFETCH_BLOCK_MESSAGE,
      BASH_ROUTED_MESSAGE,
    ].join("\n")
    //#when: scanned for V1 tokens
    //#then: zero V1 names, V2 names present
    expect(all).not.toContain("ctx_batch_execute")
    expect(all).not.toContain("ctx_execute_file")
    expect(all).not.toContain("ctx_fetch_and_index")
    expect(all).toContain("ctx_execute")
    expect(all).toContain("ctx_batch")
    expect(all).toContain("ctx_index")
  })
})
