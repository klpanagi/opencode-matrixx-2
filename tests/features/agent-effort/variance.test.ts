/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import {
  VARIANCE_FLAG_THRESHOLD,
  computePlanVariance,
  computeVariance,
} from "../../../src/features/agent-effort/variance"

describe("computeVariance", () => {
  test("slight overage stays ontrack (120 vs 100)", async () => {
    //#given
    const input = { actual: 120, estimate: 100 }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBe(20)
    expect(result.pct).toBeCloseTo(0.2, 10)
    expect(result.flag).toBe("ontrack")
  })

  test("flags over when beyond threshold (160 vs 100)", async () => {
    //#given
    const input = { actual: 160, estimate: 100 }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBe(60)
    expect(result.pct).toBeCloseTo(0.6, 10)
    expect(result.flag).toBe("over")
  })

  test("flags under when beyond threshold (40 vs 100)", async () => {
    //#given
    const input = { actual: 40, estimate: 100 }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBe(-60)
    expect(result.pct).toBeCloseTo(-0.6, 10)
    expect(result.flag).toBe("under")
  })

  test("exact match yields zero delta and ontrack (100 vs 100)", async () => {
    //#given
    const input = { actual: 100, estimate: 100 }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBe(0)
    expect(result.pct).toBe(0)
    expect(result.flag).toBe("ontrack")
  })

  test("missing estimate yields nulls and unknown", async () => {
    //#given
    const input = { actual: 100, estimate: undefined }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBeNull()
    expect(result.pct).toBeNull()
    expect(result.flag).toBe("unknown")
  })

  test("zero estimate yields delta but null pct", async () => {
    //#given
    const input = { actual: 10, estimate: 0 }

    //#when
    const result = computeVariance(input)

    //#then
    expect(result.delta).toBe(10)
    expect(result.pct).toBeNull()
    expect(result.flag).toBe("ontrack")
  })

  test("non-finite inputs yield nulls and unknown", async () => {
    //#given
    const inputs = [
      { actual: Number.NaN, estimate: 100 },
      { actual: 100, estimate: Number.POSITIVE_INFINITY },
      { actual: Number.NEGATIVE_INFINITY, estimate: Number.NaN },
    ]

    //#when
    const results = inputs.map((input) => computeVariance(input))

    //#then
    for (const result of results) {
      expect(result.delta).toBeNull()
      expect(result.pct).toBeNull()
      expect(result.flag).toBe("unknown")
    }
  })

  test("threshold constant is advisory-only 0.5", async () => {
    //#given
    const expected = 0.5

    //#when
    const value = VARIANCE_FLAG_THRESHOLD

    //#then
    expect(value).toBe(expected)
  })
})

describe("computePlanVariance", () => {
  test("reuses computeVariance for plan totals", async () => {
    //#given
    const actual = { total: 40, tokenUsd: 1.5 }
    const estimate = { total: 100 }

    //#when
    const result = computePlanVariance(actual, estimate)

    //#then
    expect(result.totalDelta).toBe(-60)
    expect(result.totalPct).toBeCloseTo(-0.6, 10)
    expect(result.totalFlag).toBe("under")
  })

  test("never throws on hostile input", async () => {
    //#given
    const actual = { total: Number.NaN, tokenUsd: Number.POSITIVE_INFINITY }
    const estimate = { total: undefined as unknown as number }

    //#when
    const result = computePlanVariance(actual, estimate)

    //#then
    expect(result.totalDelta).toBeNull()
    expect(result.totalPct).toBeNull()
    expect(result.totalFlag).toBe("unknown")
  })
})
