/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import { collectPlanEffort } from "../../../src/features/agent-effort/plan-rollup"

describe("collectPlanEffort", () => {
  test("sums finite totals and tokenUsd across fixtures", () => {
    //#given
    const inputs = [
      { taskId: "T-1", effort: { total: 2.5, tokenUsd: 0.01, computedAt: "2026-11-08T00:00:00.000Z" } },
      { taskId: "T-2", effort: { total: 3.5, tokenUsd: 0.02, computedAt: "2026-11-08T01:00:00.000Z" } },
    ]

    //#when
    const result = collectPlanEffort(inputs)

    //#then
    expect(result.total).toBe(6)
    expect(result.tokenUsd).toBeCloseTo(0.03, 10)
    expect(result.taskCount).toBe(2)
  })

  test("ignores non-finite and missing values", () => {
    //#given
    const inputs = [
      { taskId: "T-1", effort: { total: Number.NaN, tokenUsd: 0.01 } },
      { taskId: "T-2", effort: { total: Number.POSITIVE_INFINITY, tokenUsd: Number.NEGATIVE_INFINITY } },
      { taskId: "T-3", effort: null },
      { taskId: "T-4" },
      { taskId: "T-5", effort: { total: 4, tokenUsd: 0.04 } },
    ]

    //#when
    const result = collectPlanEffort(inputs)

    //#then
    expect(result.total).toBe(4)
    expect(result.tokenUsd).toBeCloseTo(0.04, 10)
    expect(result.taskCount).toBe(1)
    expect(Number.isFinite(result.total)).toBe(true)
    expect(Number.isFinite(result.tokenUsd)).toBe(true)
  })

  test("empty input yields zeros not NaN", () => {
    //#given
    const inputs: Array<{ taskId: string }> = []

    //#when
    const result = collectPlanEffort(inputs)

    //#then
    expect(result.total).toBe(0)
    expect(result.tokenUsd).toBe(0)
    expect(result.taskCount).toBe(0)
    expect(Number.isFinite(result.total)).toBe(true)
    expect(Number.isFinite(result.tokenUsd)).toBe(true)
  })

  test("computedAt is the latest valid ISO timestamp", () => {
    //#given
    const inputs = [
      { taskId: "T-1", effort: { total: 1, tokenUsd: 0.01, computedAt: "2026-11-08T00:00:00.000Z" } },
      { taskId: "T-2", effort: { total: 2, tokenUsd: 0.02, computedAt: "2026-11-08T02:00:00.000Z" } },
      { taskId: "T-3", effort: { total: 3, tokenUsd: 0.03, computedAt: "not-a-date" } },
    ]

    //#when
    const result = collectPlanEffort(inputs)

    //#then
    expect(result.computedAt).toBe("2026-11-08T02:00:00.000Z")
  })
})
