import { describe, expect, test } from "bun:test"
import { shapeSummaryNodes } from "../../../src/features/session-memory/summary"

describe("shapeSummaryNodes", () => {
  test("returns empty array for empty input", () => {
    //#given
    const entries: { id: string; sessionId: string; messageId: string; text: string }[] = []
    //#when
    const nodes = shapeSummaryNodes(entries)
    //#then
    expect(nodes).toEqual([])
  })

  test("truncates per message to perMessageBudget verbatim", () => {
    //#given
    const long = `hello ${"z".repeat(500)}`
    //#when
    const nodes = shapeSummaryNodes(
      [{ id: "a", sessionId: "s", messageId: "m", text: long }],
      { perMessageBudget: 110 },
    )
    //#then
    expect(nodes).toHaveLength(1)
    expect(nodes[0].snippet.length).toBeLessThanOrEqual(110)
    expect(nodes[0].snippet.endsWith("...")).toBe(true)
  })

  test("sorts deterministically regardless of input order", () => {
    //#given
    const entries = [
      { id: "b", sessionId: "s", messageId: "m2", text: "second" },
      { id: "a", sessionId: "s", messageId: "m1", text: "first" },
    ]
    //#when
    const nodes = shapeSummaryNodes(entries)
    const again = shapeSummaryNodes([...entries].reverse())
    //#then
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(again.map((n) => n.id)).toEqual(["a", "b"])
  })

  test("caps total output at compactContextLimit", () => {
    //#given
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${String(i).padStart(2, "0")}`,
      sessionId: "s",
      messageId: `m-${String(i).padStart(2, "0")}`,
      text: "x".repeat(100),
    }))
    //#when
    const nodes = shapeSummaryNodes(entries, { perMessageBudget: 110, compactContextLimit: 1200 })
    const total = nodes.reduce((sum, n) => sum + n.snippet.length, 0)
    //#then
    expect(total).toBeLessThanOrEqual(1200)
    expect(nodes.length).toBeGreaterThan(0)
  })
})
