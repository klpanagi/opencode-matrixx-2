import { type NativeMemoryConfig, MemoryConfigSchema } from "../../config/schema/memory"
import { isSyntheticMessage } from "./constants"
import type { MemoryEntry } from "./types"

export type RecallScope = "session" | "project" | "global" | "all"

export interface RecallCandidate {
  id: string
  sessionId: string
  messageId: string
  scope: RecallScope
  text: string
  toolName?: string
  kind?: "message" | "summary" | "artifact"
}

export interface RecallScopeProfile {
  worktree: string
  scope?: RecallScope
}

export interface RecallOptions {
  scope?: RecallScope
  sessionId?: string
  worktree?: string
  scopeProfiles?: RecallScopeProfile[]
  scopeDefault?: RecallScope
  ignoreToolPrefixes?: string[]
  perMessageBudget?: number
  maxChars?: number
  minTokens?: number
  maxMessageHits?: number
  maxSummaryHits?: number
  maxArtifactHits?: number
  budgets?: Record<RecallScope, number>
}

export interface RecallHit {
  kind: "message" | "summary" | "artifact"
  id: string
  sessionId: string
  messageId: string
  scope: RecallScope
  snippet: string
}

const DEFAULT_BUDGETS: Record<RecallScope, number> = {
  session: 16,
  project: 12,
  global: 8,
  all: 6,
}

function memoryDefaults(): NativeMemoryConfig {
  return MemoryConfigSchema.parse({}).native
}

function normalizeScope(value: unknown): RecallScope | undefined {
  if (value === "session" || value === "project" || value === "global" || value === "all") return value
  return undefined
}

/**
 * Scope precedence: explicit > profile (worktree match) > default.
 * Pure — no IO.
 */
export function resolveRecallScope(options: RecallOptions = {}): RecallScope {
  const explicit = normalizeScope(options.scope)
  if (explicit) return explicit
  if (options.worktree) {
    const profile = (options.scopeProfiles ?? []).find((p) => p.worktree === options.worktree)
    const fromProfile = normalizeScope(profile?.scope)
    if (fromProfile) return fromProfile
  }
  if (options.scopeDefault) return options.scopeDefault
  const defaults = memoryDefaults()
  const grepDefault = normalizeScope(defaults.scopeDefaults.grep)
  return grepDefault ?? "session"
}

/** Verbatim truncate — mirrors upstream truncate(), no text mutation beyond cut. */
export function truncateRecall(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`
}

/**
 * Shared-backed synthetic gate (single source: constants.isSyntheticMessage,
 * which references the shared closed table). Text-only on payload strings.
 */
export function isSyntheticCandidate(text: string): boolean {
  return isSyntheticMessage(text)
}

function toCandidate(entry: MemoryEntry | RecallCandidate): RecallCandidate {
  const kind = (entry as RecallCandidate).kind
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    messageId: entry.messageId,
    scope: normalizeScope((entry as RecallCandidate).scope) ?? "session",
    text: (entry as RecallCandidate).text ?? "",
    toolName: (entry as RecallCandidate).toolName,
    kind: kind === "summary" || kind === "artifact" ? kind : "message",
  }
}

/**
 * Non-destructive ctx_-style prefix filter: skips candidates whose toolName
 * starts with any ignoreToolPrefixes entry. Input array is never mutated.
 */
export function filterPrefixedTools(candidates: RecallCandidate[], ignoreToolPrefixes: string[]): RecallCandidate[] {
  if (ignoreToolPrefixes.length === 0) return [...candidates]
  return candidates.filter((c) => {
    if (!c.toolName) return true
    return !ignoreToolPrefixes.some((prefix) => c.toolName?.startsWith(prefix))
  })
}

function tokenizeRecall(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean)
}

/**
 * Pure sync verbatim scan over candidates. No LLM, no IO, no index-engine.
 * Per-message truncation to perMessageBudget; per-kind hit caps
 * (maxMessageHits/maxSummaryHits/maxArtifactHits); total output capped
 * by maxChars at render time.
 */
export function recall(
  entries: (MemoryEntry | RecallCandidate)[],
  query: string,
  options: RecallOptions = {},
): RecallHit[] {
  const defaults = memoryDefaults()
  const ignoreToolPrefixes = options.ignoreToolPrefixes ?? defaults.ignoreToolPrefixes
  const perMessageBudget = options.perMessageBudget ?? defaults.perMessageBudget
  const minTokens = options.minTokens ?? defaults.automaticRetrieval.minTokens
  const maxMessageHits = options.maxMessageHits ?? defaults.automaticRetrieval.maxMessageHits
  const maxSummaryHits = options.maxSummaryHits ?? defaults.automaticRetrieval.maxSummaryHits
  const maxArtifactHits = options.maxArtifactHits ?? defaults.automaticRetrieval.maxArtifactHits
  const budgets = options.budgets ?? { ...DEFAULT_BUDGETS }

  const tokens = tokenizeRecall(query)
  if (tokens.length < minTokens) return []

  const scope = resolveRecallScope(options)
  const candidates = filterPrefixedTools(entries.map(toCandidate), ignoreToolPrefixes)

  const inScope =
    scope === "all" ? candidates : candidates.filter((c) => c.scope === scope || c.scope === "all")
  const scoped = inScope.slice(0, budgets[scope] ?? inScope.length)

  const quotas = { message: maxMessageHits, summary: maxSummaryHits, artifact: maxArtifactHits }
  const hits: RecallHit[] = []
  for (const candidate of scoped) {
    const kind = candidate.kind ?? "message"
    if (quotas[kind] <= 0) continue
    const blob = candidate.text.replace(/\s+/g, " ").trim()
    if (!blob) continue
    if (isSyntheticCandidate(blob)) continue
    const lower = blob.toLowerCase()
    if (!tokens.some((token) => lower.includes(token))) continue
    quotas[kind] -= 1
    hits.push({
      kind,
      id: candidate.id,
      sessionId: candidate.sessionId,
      messageId: candidate.messageId,
      scope: candidate.scope,
      snippet: truncateRecall(blob, perMessageBudget),
    })
    if (quotas.message <= 0 && quotas.summary <= 0 && quotas.artifact <= 0) break
  }
  return hits
}

/** Render hits to context text, truncated verbatim to maxChars (default 900). */
export function renderRecallContext(hits: RecallHit[], scope: RecallScope, maxChars?: number): string {
  const limit = maxChars ?? memoryDefaults().automaticRetrieval.maxChars
  const lines = [
    `[recalled ${hits.length} hit(s) for this turn (scope=${scope}).]`,
    `Hits: ${hits.map((h) => `${h.kind} id=${h.id}: ${h.snippet}`).join(" | ")}`,
  ]
  return truncateRecall(lines.join("\n"), limit)
}
