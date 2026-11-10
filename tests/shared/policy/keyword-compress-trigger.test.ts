/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG,
  matchesCompressKeyword,
  resolveKeywordCompressTriggerConfig,
  shouldInjectForKeyword,
} from "../../../src/shared/policy/keyword-compress-trigger"
import { COMPRESS_WATCHDOG_MARKER } from "../../../src/shared/policy/compress-watchdog"

describe("resolveKeywordCompressTriggerConfig", () => {
  test("applies documented defaults when input is undefined", async () => {
    //#given no input
    //#when
    const config = resolveKeywordCompressTriggerConfig(undefined)

    //#then
    expect(config).toEqual({
      enabled: true,
      keywords: ["dcp-compress", "compress context", "run dcp"],
    })
    expect(config).toEqual(DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG)
  })

  test("trims entries, drops empties, and dedupes case-insensitively keeping first", async () => {
    //#given overlapping keywords with whitespace and case variants
    //#when
    const config = resolveKeywordCompressTriggerConfig({
      keywords: ["  dcp-compress ", "DCP-COMPRESS", "run dcp", "RUN DCP", "  ", "fresh"],
    })

    //#then
    expect(config.keywords).toEqual(["dcp-compress", "run dcp", "fresh"])
    expect(config.enabled).toBe(true)
  })

  test("caps at 16 keywords and drops overlong entries", async () => {
    //#given too many keywords plus an overlong one
    const many = Array.from({ length: 20 }, (_, i) => `kw${i}`)
    const overlong = "x".repeat(65)
    //#when
    const config = resolveKeywordCompressTriggerConfig({ keywords: [overlong, ...many] })

    //#then
    expect(config.keywords.length).toBeLessThanOrEqual(16)
    expect(config.keywords).not.toContain(overlong)
  })

  test("enabled defaults to true when omitted", async () => {
    //#given keywords without an enabled flag
    //#when
    const config = resolveKeywordCompressTriggerConfig({ keywords: ["hi"] })

    //#then
    expect(config.enabled).toBe(true)
  })
})

describe("matchesCompressKeyword", () => {
  test("matches each default keyword", async () => {
    //#given the default keyword list
    const keywords = DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG.keywords

    //#when matching sentences containing each keyword
    //#then
    expect(matchesCompressKeyword("please dcp-compress now", keywords)).toBe(true)
    expect(matchesCompressKeyword("can you compress context please", keywords)).toBe(true)
    expect(matchesCompressKeyword("please run dcp", keywords)).toBe(true)
  })

  test("is case-insensitive and tolerates trailing punctuation", async () => {
    //#given mixed-case text with punctuation
    //#when
    const upper = matchesCompressKeyword("DCP-Compress.", ["dcp-compress"])

    //#then
    expect(upper).toBe(true)
  })

  test("collapses whitespace runs inside multi-word keywords", async () => {
    //#given a multi-word keyword matched across newlines
    //#when
    const matched = matchesCompressKeyword("compress\n  context", ["compress context"])

    //#then
    expect(matched).toBe(true)
  })

  test("rejects suffix matches, bare words, and empty text", async () => {
    //#given negative inputs
    //#when / #then
    expect(matchesCompressKeyword("dcp-compressed", ["dcp-compress"])).toBe(false)
    expect(matchesCompressKeyword("please compress the files", ["dcp-compress", "compress context", "run dcp"])).toBe(false)
    expect(matchesCompressKeyword("", ["dcp-compress"])).toBe(false)
  })
})

describe("shouldInjectForKeyword", () => {
  test("injects when enabled, matched, cooled down, and unmarked", async () => {
    //#given an armed keyword trigger
    //#when
    const result = shouldInjectForKeyword({
      config: { enabled: true, keywords: ["dcp-compress"] },
      lastUserText: "please dcp-compress now",
      turnsSinceLastInjection: 5,
      cooldownTurns: 2,
    })

    //#then
    expect(result).toBe(true)
  })

  test("stays silent when disabled, missing text, unmatched, cooling down, or marked", async () => {
    //#given guard branches
    //#when / #then
    expect(
      shouldInjectForKeyword({
        config: { enabled: false, keywords: ["dcp-compress"] },
        lastUserText: "please dcp-compress",
        turnsSinceLastInjection: 9,
        cooldownTurns: 2,
      }),
    ).toBe(false)
    expect(
      shouldInjectForKeyword({
        config: { enabled: true, keywords: ["dcp-compress"] },
        lastUserText: undefined,
        turnsSinceLastInjection: 9,
        cooldownTurns: 2,
      }),
    ).toBe(false)
    expect(
      shouldInjectForKeyword({
        config: { enabled: true, keywords: ["dcp-compress"] },
        lastUserText: "hello there",
        turnsSinceLastInjection: 9,
        cooldownTurns: 2,
      }),
    ).toBe(false)
    expect(
      shouldInjectForKeyword({
        config: { enabled: true, keywords: ["dcp-compress"] },
        lastUserText: "please dcp-compress",
        turnsSinceLastInjection: 1,
        cooldownTurns: 2,
      }),
    ).toBe(false)
    expect(
      shouldInjectForKeyword({
        config: { enabled: true, keywords: ["dcp-compress"] },
        lastUserText: `please dcp-compress ${COMPRESS_WATCHDOG_MARKER}`,
        turnsSinceLastInjection: 9,
        cooldownTurns: 2,
      }),
    ).toBe(false)
  })
})
