/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import {
  estimateTodoEffort,
  parseEffortEstimateComment,
  upsertEffortEstimateComment,
} from "../../../src/features/agent-effort/estimate"

const SMALL_TODO = "Fix typo in README"
const MEDIUM_TODO = "Add unit tests for plan-storage in src/features/mission-state/plan-storage.ts; run bun test and typecheck to verify"
const LARGE_TODO =
  "Cross-cutting multi-service auth refactor: migrate schema in src/api/auth.ts and src/db/schema.ts, " +
  "handle parallel concurrent sessions with performance optimization; run test, typecheck, lint, build and verify"

describe("estimateTodoEffort", () => {
  test("small/medium/large fixtures produce monotonically ordered units", () => {
    //#given
    const small = SMALL_TODO
    const medium = MEDIUM_TODO
    const large = LARGE_TODO

    //#when
    const smallUnits = estimateTodoEffort(small).units
    const mediumUnits = estimateTodoEffort(medium).units
    const largeUnits = estimateTodoEffort(large).units

    //#then
    expect(smallUnits).toBeLessThan(mediumUnits)
    expect(mediumUnits).toBeLessThan(largeUnits)
  })

  test("trivial text yields the minimum floor of 0.5", () => {
    //#given
    const todo = SMALL_TODO

    //#when
    const result = estimateTodoEffort(todo)

    //#then
    expect(result.units).toBe(0.5)
    expect(result.method).toBe("fallback")
  })

  test("is pure and deterministic across repeated calls", () => {
    //#given
    const todo = MEDIUM_TODO

    //#when
    const first = estimateTodoEffort(todo)
    const second = estimateTodoEffort(todo)

    //#then
    expect(second).toEqual(first)
    expect(Number.isFinite(second.units)).toBe(true)
    expect(second.units).toBeGreaterThanOrEqual(0.5)
  })

  test("never throws and stays finite on hostile input", () => {
    //#given
    const inputs = ["", "   ", "test ".repeat(500) + "refactor ".repeat(100)]

    //#when
    const results = inputs.map((todo) => estimateTodoEffort(todo))

    //#then
    for (const result of results) {
      expect(Number.isFinite(result.units)).toBe(true)
      expect(result.units).toBeGreaterThanOrEqual(0.5)
      expect(result.method).toBe("fallback")
    }
  })
})

describe("parseEffortEstimateComment", () => {
  test("parses a well-formed effort estimate comment", () => {
    //#given
    const content = `# Plan\n\n<!-- effort-estimate: {"perTodo":{"Task A":1.5},"total":1.5,"method":"human"} -->\n`

    //#when
    const result = parseEffortEstimateComment(content)

    //#then
    expect(result).not.toBeNull()
    expect(result?.perTodo).toEqual({ "Task A": 1.5 })
    expect(result?.total).toBe(1.5)
    expect(result?.method).toBe("human")
  })

  test("returns null on malformed comment", () => {
    //#given
    const content = `# Plan\n\n<!-- effort-estimate: {not valid json} -->\n`

    //#when
    const result = parseEffortEstimateComment(content)

    //#then
    expect(result).toBeNull()
  })

  test("returns null when no comment is present", () => {
    //#given
    const content = "# Plan\n\nJust prose, no comment.\n"

    //#when
    const result = parseEffortEstimateComment(content)

    //#then
    expect(result).toBeNull()
  })
})

describe("upsertEffortEstimateComment", () => {
  test("merge rule keeps human values and fills gaps with fallback", () => {
    //#given
    const content = `# Plan\n\n<!-- effort-estimate: {"perTodo":{"Task A":1.5},"total":1.5,"method":"human"} -->\n`
    const estimate = { perTodo: { "Task A": 9.9, "Task B": 2.25 }, total: 12.15, method: "fallback" as const }

    //#when
    const result = parseEffortEstimateComment(upsertEffortEstimateComment(content, estimate))

    //#then
    expect(result?.perTodo?.["Task A"]).toBe(1.5)
    expect(result?.perTodo?.["Task B"]).toBe(2.25)
    expect(result?.method).toBe("mixed")
  })

  test("appends a comment when none exists", () => {
    //#given
    const content = "# Plan\n\nJust prose.\n"
    const estimate = { perTodo: { "Task A": 0.5 }, total: 0.5, method: "fallback" as const }

    //#when
    const updated = upsertEffortEstimateComment(content, estimate)

    const result = parseEffortEstimateComment(updated)

    //#then
    expect(result?.perTodo).toEqual({ "Task A": 0.5 })
    expect(result?.method).toBe("fallback")
  })
})
