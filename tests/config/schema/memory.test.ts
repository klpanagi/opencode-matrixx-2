/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { MemoryConfigSchema } from "../../../src/config/schema/memory"

describe("MemoryConfigSchema defaults", () => {
  test("disabled by default (opt-in)", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then enabled is false
    expect(parsed.enabled).toBe(false)
  })

  test("ignores ctx_ tool prefixes by default", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then prefix list matches upstream
    expect(parsed.ignoreToolPrefixes).toEqual(["ctx_"])
  })

  test("staleSessionDays undefined by default (disabled, NOT 90)", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then stale undefined with deletion/orphan defaults
    expect(parsed.retention.staleSessionDays).toBeUndefined()
    expect(parsed.retention.deletedSessionDays).toBe(30)
    expect(parsed.retention.orphanBlobDays).toBe(14)
  })

  test("per-message budget and compact limit defaults", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then budgets match upstream DEFAULT_SUMMARY_V2
    expect(parsed.perMessageBudget).toBe(110)
    expect(parsed.compactContextLimit).toBe(1200)
    expect(parsed.systemHint).toBe(true)
  })

  test("automatic retrieval budgets defaults", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then retrieval defaults mirror opencode-lcm DEFAULT_OPTIONS
    expect(parsed.automaticRetrieval.maxChars).toBe(900)
    expect(parsed.automaticRetrieval.minTokens).toBe(2)
    expect(parsed.automaticRetrieval.maxMessageHits).toBe(2)
    expect(parsed.automaticRetrieval.maxSummaryHits).toBe(1)
    expect(parsed.automaticRetrieval.maxArtifactHits).toBe(1)
    expect(parsed.automaticRetrieval.budgets).toEqual({ session: 16, root: 12, worktree: 8, all: 6 })
  })

  test("scope defaults to session", () => {
    //#given empty input
    const input = {}
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then grep/describe session, no profiles
    expect(parsed.scopeDefaults).toEqual({ grep: "session", describe: "session" })
    expect(parsed.scopeProfiles).toEqual([])
  })

  test("explicit quotas override defaults", () => {
    //#given custom budgets
    const input = { automaticRetrieval: { budgets: { session: 4, root: 3, worktree: 2, all: 1 } } }
    //#when parsing
    const parsed = MemoryConfigSchema.parse(input)
    //#then overrides applied
    expect(parsed.automaticRetrieval.budgets).toEqual({ session: 4, root: 3, worktree: 2, all: 1 })
  })
})
