import { describe, expect, test } from "bun:test"
import {
  filterPrefixedTools,
  recall,
  renderRecallContext,
  resolveRecallScope,
  type RecallCandidate,
} from "../../../src/features/session-memory/recall"

function makeCandidates(): RecallCandidate[] {
  return [
    { id: "a", sessionId: "s1", messageId: "m1", scope: "session", text: "fix the login bug today" },
    { id: "b", sessionId: "s1", messageId: "m2", scope: "session", text: "login flow retried", kind: "summary" },
    { id: "c", sessionId: "s1", messageId: "m3", scope: "session", text: "login artifact data", kind: "artifact" },
    { id: "d", sessionId: "s2", messageId: "m4", scope: "project", text: "login elsewhere" },
  ]
}

describe("resolveRecallScope", () => {
  test("explicit scope wins over profile and default", () => {
    //#given
    const options = { scope: "project" as const, worktree: "/w", scopeProfiles: [{ worktree: "/w", scope: "global" as const }], scopeDefault: "session" as const }
    //#when
    const result = resolveRecallScope(options)
    //#then
    expect(result).toBe("project")
  })

  test("profile beats default when no explicit scope", () => {
    //#given
    const options = { worktree: "/w", scopeProfiles: [{ worktree: "/w", scope: "global" as const }], scopeDefault: "session" as const }
    //#when
    const result = resolveRecallScope(options)
    //#then
    expect(result).toBe("global")
  })

  test("falls back to default then config default", () => {
    //#given
    const withDefault = { scopeDefault: "project" as const }
    //#when
    const a = resolveRecallScope(withDefault)
    const b = resolveRecallScope({})
    //#then
    expect(a).toBe("project")
    expect(b).toBe("session")
  })
})

describe("recall", () => {
  test("skips ctx_-prefixed tools non-destructively", () => {
    //#given
    const input: RecallCandidate[] = [
      { id: "x", sessionId: "s", messageId: "m", scope: "session", text: "login secret", toolName: "ctx_search" },
      { id: "y", sessionId: "s", messageId: "m2", scope: "session", text: "login visible" },
    ]
    const before = input.length
    //#when
    const hits = recall(input, "login visible", { scope: "session", minTokens: 1 })
    const filtered = filterPrefixedTools(input, ["ctx_"])
    //#then
    expect(input).toHaveLength(before)
    expect(filtered.map((c) => c.id)).toEqual(["y"])
    expect(hits.map((h) => h.id)).toEqual(["y"])
  })

  test("truncates per message to perMessageBudget verbatim", () => {
    //#given
    const long = `login ${"z".repeat(500)}`
    const input: RecallCandidate[] = [{ id: "l", sessionId: "s", messageId: "m", scope: "session", text: long }]
    //#when
    const hits = recall(input, "login", { scope: "session", minTokens: 1, perMessageBudget: 110 })
    //#then
    expect(hits).toHaveLength(1)
    expect(hits[0].snippet.length).toBeLessThanOrEqual(110)
    expect(hits[0].snippet.endsWith("...")).toBe(true)
  })

  test("enforces minTokens and per-kind hit quotas", () => {
    //#given
    const input = makeCandidates()
    //#when
    const tooShort = recall(input, "login", { scope: "session", minTokens: 2 })
    const capped = recall(input, "login flow", { scope: "session", minTokens: 1, maxMessageHits: 1, maxSummaryHits: 0, maxArtifactHits: 0 })
    //#then
    expect(tooShort).toEqual([])
    expect(capped.map((h) => h.kind)).toEqual(["message"])
  })

  test("renderRecallContext enforces maxChars", () => {
    //#given
    const hits = recall(makeCandidates(), "login", { scope: "session", minTokens: 1 })
    //#when
    const text = renderRecallContext(hits, "session", 60)
    //#then
    expect(text.length).toBeLessThanOrEqual(60)
    expect(text.endsWith("...")).toBe(true)
  })
})
