import { describe, expect, test } from "bun:test"
import { COMPACTING_SNIPPET_BUDGET, getCompactingSnippet } from "../../../src/features/session-memory/compacting"

describe("getCompactingSnippet", () => {
  test("returns empty string for empty input", () => {
    //#given
    const input: string[] = []
    //#when
    const snippet = getCompactingSnippet(input)
    //#then
    expect(snippet).toEqual("")
  })

  test("truncates over-budget string input to budget", () => {
    //#given
    const long = "y".repeat(5000)
    //#when
    const snippet = getCompactingSnippet(long, 1200)
    //#then
    expect(snippet.length).toBeLessThanOrEqual(1200)
    expect(snippet.endsWith("...")).toBe(true)
  })

  test("caps joined node snippets at default 1200 budget", () => {
    //#given
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${String(i).padStart(2, "0")}`,
      sessionId: "s",
      messageId: `m-${String(i).padStart(2, "0")}`,
      snippet: "x".repeat(100),
    }))
    //#when
    const snippet = getCompactingSnippet(nodes)
    //#then
    expect(snippet.length).toBeLessThanOrEqual(COMPACTING_SNIPPET_BUDGET)
    expect(snippet.length).toBeGreaterThan(0)
  })

  test("default budget is 1200", () => {
    //#given
    const budget = COMPACTING_SNIPPET_BUDGET
    //#when
    const snippet = getCompactingSnippet("hello", budget)
    //#then
    expect(budget).toEqual(1200)
    expect(snippet).toEqual("hello")
  })
})
