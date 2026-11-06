/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  _resetContextModeEnforcementForTesting,
  _setDisciplinePathForTesting,
  isCtxToolsAvailable,
  resolveContextModeDisciplineInfo,
  willBlockGrepGlob,
} from "../../src/shared/policy/context-mode-enforcement"
import { WARN_MESSAGE_READ } from "../../src/hooks/context-mode-enforcer/constants"

describe("context-mode fail-open parity (P4-P6)", () => {
  test("discipline missing resolves to null path", () => {
    //#given no substitute on disk
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(null)

    //#when discipline info resolved
    const info = resolveContextModeDisciplineInfo()

    //#then fail-open nulls, never throws
    expect(info.path).toBeNull()
    expect(info.version).toBeNull()
    _resetContextModeEnforcementForTesting()
  })

  test("discipline missing implies ctx tools unavailable", () => {
    //#given no discipline path
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(null)

    //#when availability checked
    //#then false — hook stays warn-only
    expect(isCtxToolsAvailable()).toBe(false)
    _resetContextModeEnforcementForTesting()
  })

  test("hook read guidance is warn-only (never throws, names Edit carve-out)", () => {
    //#given the enforcer read warning text
    //#when inspected
    //#then warn-only wording with bounded-Read carve-out
    expect(WARN_MESSAGE_READ).toContain("Read is CORRECT when you intend to Edit")
    expect(WARN_MESSAGE_READ).not.toMatch(/Blocked|forbidden/i)
  })

  test("enforce:true without substitute does not block grep/glob", () => {
    //#given enforce requested but no working substitute
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(null)

    //#when the block predicate is evaluated
    //#then false — warn-only fallback, agent never stranded
    expect(willBlockGrepGlob({ enforce: true })).toBe(false)
    expect(willBlockGrepGlob({ enforce: true, blocked_tools: ["grep", "glob", "webfetch"] })).toBe(false)
    _resetContextModeEnforcementForTesting()
  })
})
