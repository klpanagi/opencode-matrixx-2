/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { EffortConfigSchema, EffortWeightsSchema } from "../../../src/config/schema/effort"

describe("EffortConfigSchema", () => {
  test("applies every default when the block is empty", () => {
    //#given
    const input = {}

    //#when
    const parsed = EffortConfigSchema.parse(input)

    //#then
    expect(parsed.enabled).toBe(true)
    expect(parsed.report).toEqual(["parent"])
    expect(parsed.weights).toEqual({ compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 })
    expect(parsed.prices).toEqual({
      inputPer1k: 0.003,
      outputPer1k: 0.015,
      cacheReadPer1k: 0.0003,
      cacheWritePer1k: 0.00375,
    })
    expect(parsed.toolCosts).toEqual({})
    expect(parsed.maxMessages).toBe(200)
    expect(parsed.maxBytes).toBe(2_097_152)
    expect(parsed.rollup).toBe(false)
  })

  test("merges a partial weights override with the remaining defaults", () => {
    //#given
    const input = { weights: { compute: 1 } }

    //#when
    const parsed = EffortConfigSchema.parse(input)

    //#then
    expect(parsed.weights).toEqual({ compute: 1, action: 0.25, epistemic: 0.15, coord: 0.1 })
  })

  test("honours enabled:false", () => {
    //#given
    const input = { enabled: false }

    //#when
    const parsed = EffortConfigSchema.parse(input)

    //#then
    expect(parsed.enabled).toBe(false)
  })

  test("rejects a negative weight", () => {
    //#given
    const input = { weights: { compute: -0.1 } }

    //#when
    const parsed = EffortWeightsSchema.safeParse(input.weights)

    //#then
    expect(parsed.success).toBe(false)
  })

  test("rejects an unknown report channel", () => {
    //#given
    const input = { report: ["email"] }

    //#when
    const parsed = EffortConfigSchema.safeParse(input)

    //#then
    expect(parsed.success).toBe(false)
  })

  test("accepts a fully specified override", () => {
    //#given
    const input = {
      enabled: true,
      report: ["toast", "log"],
      weights: { compute: 2, action: 1, epistemic: 0.5, coord: 0.25 },
      prices: { inputPer1k: 1, outputPer1k: 2, cacheReadPer1k: 0.1, cacheWritePer1k: 0.2 },
      toolCosts: { read: 0.5, bash: 1 },
      maxMessages: 50,
      maxBytes: 4096,
      rollup: true,
    }

    //#when
    const parsed = EffortConfigSchema.parse(input)

    //#then
    expect(parsed.report).toEqual(["toast", "log"])
    expect(parsed.toolCosts).toEqual({ read: 0.5, bash: 1 })
    expect(parsed.rollup).toBe(true)
  })
})
