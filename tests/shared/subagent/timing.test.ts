/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { __resetTimingConfig, __setTimingConfig, getTimingConfig, setPollTimeoutMs } from "../../../src/shared/subagent/timing"

describe("timing defaults", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("default MAX_POLL_TIME_MS is 600000 (10 min)", () => {
    //#given default state (no config override)

    //#when
    const config = getTimingConfig()

    //#then
    expect(config.MAX_POLL_TIME_MS).toBe(600_000)
  })

  test("setPollTimeoutMs updates MAX_POLL_TIME_MS", () => {
    //#given
    const customValue = 300_000

    //#when
    setPollTimeoutMs(customValue)

    //#then
    expect(getTimingConfig().MAX_POLL_TIME_MS).toBe(customValue)
  })

  test("getTimingConfig returns updated value after setPollTimeoutMs", () => {
    //#given
    const customValue = 120_000

    //#when
    setPollTimeoutMs(customValue)

    //#then
    const config = getTimingConfig()
    expect(config.MAX_POLL_TIME_MS).toBe(120_000)
    // Verify other defaults are not affected
    expect(config.POLL_INTERVAL_MS).toBe(1000)
    expect(config.MIN_STABILITY_TIME_MS).toBe(10000)
  })

  test("setPollTimeoutMs accepts zero and non-standard values", () => {
    //#given
    const edgeCases = [0, 1, 50, 500, 3600_000]

    for (const value of edgeCases) {
      //#when
      setPollTimeoutMs(value)

      //#then
      expect(getTimingConfig().MAX_POLL_TIME_MS).toBe(value)

      // reset for next iteration
      __resetTimingConfig()
    }
  })

  test("__resetTimingConfig restores MAX_POLL_TIME_MS to 600000", () => {
    //#given
    setPollTimeoutMs(999)

    //#when
    __resetTimingConfig()

    //#then
    expect(getTimingConfig().MAX_POLL_TIME_MS).toBe(600_000)
  })

  test("__setTimingConfig overrides MAX_POLL_TIME_MS", () => {
    //#given
    const overrides = { MAX_POLL_TIME_MS: 42_000 }

    //#when
    __setTimingConfig(overrides)

    //#then
    expect(getTimingConfig().MAX_POLL_TIME_MS).toBe(42_000)
  })
})
