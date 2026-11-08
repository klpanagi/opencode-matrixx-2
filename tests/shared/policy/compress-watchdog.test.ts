/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  buildCompressDirective,
  COMPRESS_WATCHDOG_MARKER,
  extractContextUsage,
  modelListItems,
  resolveCompressWatchdogConfig,
  resolveContextLimit,
  shouldInjectCompressDirective,
  usagePercent,
} from "../../../src/shared/policy/compress-watchdog"

describe("resolveCompressWatchdogConfig", () => {
  test("applies documented defaults when the config is absent", () => {
    //#given no config
    //#when
    const config = resolveCompressWatchdogConfig(undefined)

    //#then
    expect(config).toEqual({ enabled: true, abovePercent: 25, targetPercent: 10, cooldownTurns: 2 })
  })

  test("clamps target below above so the directive is satisfiable", () => {
    //#given a target above the ceiling
    //#when
    const config = resolveCompressWatchdogConfig({ abovePercent: 20, targetPercent: 40 })

    //#then
    expect(config.abovePercent).toBe(20)
    expect(config.targetPercent).toBe(19)
  })

  test("clamps out-of-range percentages and floors the cooldown", () => {
    //#given hostile values
    //#when
    const config = resolveCompressWatchdogConfig({
      abovePercent: 500,
      targetPercent: -5,
      cooldownTurns: 0.4,
    })

    //#then
    expect(config.abovePercent).toBe(95)
    expect(config.targetPercent).toBe(1)
    expect(config.cooldownTurns).toBe(1)
  })
})

describe("extractContextUsage", () => {
  test("sums the newest assistant token report including cache", () => {
    //#given two assistant messages, the newest with cache reads
    const messages = [
      {
        type: "assistant",
        tokens: { input: 1, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      { type: "user", text: "hello" },
      {
        type: "assistant",
        model: { providerID: "commandcode", modelID: "deepseek/deepseek-v4.1-flash" },
        tokens: { input: 250_000, output: 1_000, reasoning: 0, cache: { read: 49_000, write: 0 } },
      },
    ]

    //#when
    const usage = extractContextUsage(messages)

    //#then
    expect(usage).toEqual({
      tokens: 300_000,
      providerID: "commandcode",
      modelID: "deepseek/deepseek-v4.1-flash",
    })
  })

  test("accepts the { info, parts } projection", () => {
    //#given a legacy-shaped assistant message
    const messages = [
      {
        info: {
          role: "assistant",
          providerID: "p",
          modelID: "m",
          tokens: { input: 100, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ]

    //#when
    const usage = extractContextUsage(messages)

    //#then
    expect(usage).toEqual({ tokens: 105, providerID: "p", modelID: "m" })
  })

  test("skips assistant messages without output tokens", () => {
    //#given a partial report (streaming) above a complete one
    const messages = [
      {
        type: "assistant",
        tokens: { input: 500, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      {
        type: "assistant",
        tokens: { input: 500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]

    //#when
    const usage = extractContextUsage(messages)

    //#then
    expect(usage?.tokens).toBe(501)
  })

  test("returns null when no assistant reports tokens", () => {
    //#given user-only messages
    //#when
    const usage = extractContextUsage([{ type: "user", text: "hi" }, { type: "tool", text: "x" }])

    //#then
    expect(usage).toBeNull()
  })
})

describe("resolveContextLimit", () => {
  test("matches the provider/model key from a bare array", () => {
    //#given
    const models = [
      { providerID: "other", id: "x", limit: { context: 128_000 } },
      { providerID: "commandcode", id: "deepseek/deepseek-v4.1-flash", limit: { context: 1_000_000 } },
    ]

    //#when
    const limit = resolveContextLimit(models, "commandcode", "deepseek/deepseek-v4.1-flash")

    //#then
    expect(limit).toBe(1_000_000)
  })

  test("unwraps the { data } envelope and returns null on a miss", () => {
    //#given
    const models = { data: [{ providerID: "p", id: "m", limit: { context: 200_000 } }] }

    //#when / #then
    expect(resolveContextLimit(models, "p", "m")).toBe(200_000)
    expect(resolveContextLimit(models, "p", "missing")).toBeNull()
    expect(resolveContextLimit(models, undefined, undefined)).toBeNull()
  })

  test("modelListItems tolerates unknown shapes", () => {
    //#given / #when / #then
    expect(modelListItems([1, 2])).toEqual([1, 2])
    expect(modelListItems({ models: [{ id: "a" }] })).toEqual([{ id: "a" }])
    expect(modelListItems("nope")).toEqual([])
  })
})

describe("usagePercent", () => {
  test("computes the window percentage and guards bad limits", () => {
    //#given / #when / #then
    expect(usagePercent(300_000, 1_000_000)).toBeCloseTo(30)
    expect(usagePercent(1, 0)).toBe(0)
    expect(usagePercent(Number.NaN, 100)).toBe(0)
  })
})

describe("shouldInjectCompressDirective", () => {
  const config = { enabled: true, abovePercent: 25, targetPercent: 10, cooldownTurns: 2 }

  test("arms at or above the ceiling when the cooldown elapsed", () => {
    //#given / #when / #then
    expect(
      shouldInjectCompressDirective({
        config,
        currentPercent: 30,
        turnsSinceLastInjection: 2,
        lastUserText: "continue",
      }),
    ).toBe(true)
  })

  test("stays silent below the ceiling, during cooldown, when disabled, or when already marked", () => {
    //#given / #when / #then
    expect(
      shouldInjectCompressDirective({
        config,
        currentPercent: 24.9,
        turnsSinceLastInjection: 9,
      }),
    ).toBe(false)
    expect(
      shouldInjectCompressDirective({
        config,
        currentPercent: 40,
        turnsSinceLastInjection: 1,
      }),
    ).toBe(false)
    expect(
      shouldInjectCompressDirective({
        config: { ...config, enabled: false },
        currentPercent: 40,
        turnsSinceLastInjection: 9,
      }),
    ).toBe(false)
    expect(
      shouldInjectCompressDirective({
        config,
        currentPercent: 40,
        turnsSinceLastInjection: 9,
        lastUserText: `x ${COMPRESS_WATCHDOG_MARKER} y`,
      }),
    ).toBe(false)
  })
})

describe("buildCompressDirective", () => {
  test("carries both markers and the configured percentages", () => {
    //#given
    const config = { enabled: true, abovePercent: 25, targetPercent: 12, cooldownTurns: 2 }

    //#when
    const directive = buildCompressDirective({
      currentPercent: 31.4,
      tokens: 314_000,
      limit: 1_000_000,
      config,
    })

    //#then
    expect(directive.startsWith(COMPRESS_WATCHDOG_MARKER)).toBe(true)
    expect(directive.endsWith(COMPRESS_WATCHDOG_MARKER)).toBe(true)
    expect(directive).toContain("31.4%")
    expect(directive).toContain("The configured ceiling is 25%")
    expect(directive).toContain("at or below 12%")
    expect(directive).toContain("`compress`")
  })
})
