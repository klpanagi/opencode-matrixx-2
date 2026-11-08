/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"

import { computeEffort } from "../../../src/features/agent-effort/calculate"
import { DEFAULT_PRICES, DEFAULT_WEIGHTS, FORMULA_VERSION } from "../../../src/features/agent-effort/constants"
import type { EffortTelemetry } from "../../../src/features/agent-effort/types"

function fixedTelemetry(): EffortTelemetry {
  return {
    input: 1000,
    output: 500,
    reasoning: 200,
    cacheRead: 2000,
    cacheWrite: 400,
    steps: 4,
    toolCalls: 6,
    uniqueTools: 3,
    retries: 1,
    durationMs: 12000,
  }
}

function allFinite(record: ReturnType<typeof computeEffort>): boolean {
  const values = [
    record.total,
    record.tokenUsd,
    record.components.computeUnits,
    record.components.actionUnits,
    record.components.epistemicUnits,
    record.components.coordUnits,
    record.components.tokenUsd,
    record.components.total,
  ]
  return values.every((value) => Number.isFinite(value))
}

describe("computeEffort", () => {
  describe("default weights and prices", () => {
    it("computes every component from hand-verified values", () => {
      //#given
      const telemetry = fixedTelemetry()

      //#when
      const result = computeEffort(telemetry)

      //#then
      expect(result.formulaVersion).toBe(FORMULA_VERSION)
      expect(result.tokenUsd).toBeCloseTo(0.0156, 12)
      expect(result.components.tokenUsd).toBeCloseTo(0.0156, 12)
      expect(result.components.computeUnits).toBeCloseTo(1040, 9)
      expect(result.components.actionUnits).toBeCloseTo(8.4, 9)
      expect(result.components.epistemicUnits).toBeCloseTo(3.332204510175204, 9)
      expect(result.components.coordUnits).toBe(0)
      expect(result.total).toBeCloseTo(0.6119830676526281, 9)
      expect(result.components.total).toBeCloseTo(0.6119830676526281, 9)
      expect(allFinite(result)).toBe(true)
    })
  })

  describe("custom weights", () => {
    it("normalizes arbitrary weights and scales the total proportionally", () => {
      //#given
      const telemetry = fixedTelemetry()
      const weights = { compute: 2, action: 0, epistemic: 0, coord: 0 }

      //#when
      const result = computeEffort(telemetry, weights)

      //#then
      expect(result.components.computeUnits).toBeCloseTo(1040, 9)
      expect(result.total).toBeCloseTo(1040 / 1000, 9)
    })
  })

  describe("zero output price", () => {
    it("yields zero compute units without NaN or Infinity", () => {
      //#given
      const telemetry = fixedTelemetry()
      const prices = { ...DEFAULT_PRICES, outputPer1k: 0 }

      //#when
      const result = computeEffort(telemetry, DEFAULT_WEIGHTS, prices)

      //#then
      expect(result.components.computeUnits).toBe(0)
      expect(Number.isNaN(result.total)).toBe(false)
      expect(allFinite(result)).toBe(true)
    })
  })

  describe("all-zero weight set", () => {
    it("falls back to DEFAULT_WEIGHTS", () => {
      //#given
      const telemetry = fixedTelemetry()
      const zeroWeights = { compute: 0, action: 0, epistemic: 0, coord: 0 }

      //#when
      const zeroResult = computeEffort(telemetry, zeroWeights)
      const defaultResult = computeEffort(telemetry)

      //#then
      expect(zeroResult.total).toBeCloseTo(defaultResult.total, 12)
    })
  })

  describe("metadata passthrough", () => {
    it("carries coverage, missing and an override computedAt", () => {
      //#given
      const telemetry = fixedTelemetry()
      const options = {
        coverage: "partial" as const,
        missing: ["tokens"],
        computedAt: "2026-01-01T00:00:00.000Z",
      }

      //#when
      const result = computeEffort(telemetry, undefined, undefined, options)

      //#then
      expect(result.coverage).toBe("partial")
      expect(result.missing).toEqual(["tokens"])
      expect(result.computedAt).toBe("2026-01-01T00:00:00.000Z")
    })

    it("defaults to full coverage and a generated ISO timestamp", () => {
      //#given
      const telemetry = fixedTelemetry()

      //#when
      const result = computeEffort(telemetry)

      //#then
      expect(result.coverage).toBe("full")
      expect(result.missing).toEqual([])
      expect(Number.isNaN(Date.parse(result.computedAt))).toBe(false)
    })
  })

  describe("invalid telemetry", () => {
    it("sanitizes NaN and negative fields to finite non-negative values", () => {
      //#given
      const telemetry = {
        input: Number.NaN,
        output: -5,
        reasoning: Number.POSITIVE_INFINITY,
        cacheRead: -1,
        cacheWrite: Number.NaN,
        steps: -10,
        toolCalls: Number.NaN,
        uniqueTools: -2,
        retries: -1,
        durationMs: Number.NaN,
      } as EffortTelemetry

      //#when
      const result = computeEffort(telemetry)

      //#then
      for (const value of Object.values(result.telemetry)) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
      expect(allFinite(result)).toBe(true)
    })
  })
})
