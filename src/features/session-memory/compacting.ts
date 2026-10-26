import type { SummaryNode } from "./summary"
import { truncateSummary } from "./summary"

export const COMPACTING_SNIPPET_BUDGET = 1200 as const

export type CompactingSnippetInput = string | SummaryNode[] | string[]

/**
 * Pure deterministic budgeted snippet for the compaction append path.
 * No LLM, no IO. Joins node snippets (or lines) and truncates
 * verbatim to `budget` (default 1200) even on over-budget input.
 */
export function getCompactingSnippet(input: CompactingSnippetInput = [], budget: number = COMPACTING_SNIPPET_BUDGET): string {
  const limit = budget <= 0 ? 0 : budget
  if (limit <= 0) return ""
  let text: string
  if (typeof input === "string") {
    text = input.replace(/\s+/g, " ").trim()
  } else {
    const parts = input
      .map((item) => (typeof item === "string" ? item : (item.snippet ?? "")).replace(/\s+/g, " ").trim())
      .filter(Boolean)
    if (parts.length === 0) return ""
    text = parts.join(" | ")
  }
  if (!text) return ""
  return truncateSummary(text, limit)
}
