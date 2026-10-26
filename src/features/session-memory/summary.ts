import { MemoryConfigSchema, type NativeMemoryConfig } from "../../config/schema/memory"
import type { MemoryEntry } from "./types"

export interface SummarySource {
  id: string
  sessionId: string
  messageId: string
  text: string
}

export interface SummaryNode {
  id: string
  sessionId: string
  messageId: string
  snippet: string
}

export interface ShapeSummaryOptions {
  perMessageBudget?: number
  compactContextLimit?: number
}

function memoryDefaults(): NativeMemoryConfig {
  return MemoryConfigSchema.parse({}).native
}

/** Verbatim truncate — mirrors upstream truncate(), no text mutation beyond cut. */
export function truncateSummary(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`
}

/**
 * Pure deterministic verbatim shaper. No LLM, no IO, no index-engine.
 * Sorts by (sessionId, messageId, id); truncates each message to
 * perMessageBudget (default 110); total output capped at
 * compactContextLimit (default 1200).
 */
export function shapeSummaryNodes(
  entries: (MemoryEntry | SummarySource)[],
  options: ShapeSummaryOptions = {},
): SummaryNode[] {
  const defaults = memoryDefaults()
  const perMessageBudget = options.perMessageBudget ?? defaults.perMessageBudget
  const compactContextLimit = options.compactContextLimit ?? defaults.compactContextLimit
  if (entries.length === 0 || compactContextLimit <= 0) return []
  const sorted = [...entries].sort((a, b) => {
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1
    if (a.messageId !== b.messageId) return a.messageId < b.messageId ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
  })
  const nodes: SummaryNode[] = []
  let used = 0
  for (const entry of sorted) {
    const blob = (entry.text ?? "").replace(/\s+/g, " ").trim()
    if (!blob) continue
    const remaining = compactContextLimit - used
    if (remaining <= 0) break
    const budget = Math.min(perMessageBudget, remaining)
    const snippet = truncateSummary(blob, budget)
    if (!snippet) continue
    nodes.push({ id: entry.id, sessionId: entry.sessionId, messageId: entry.messageId, snippet })
    used += snippet.length
  }
  return nodes
}
