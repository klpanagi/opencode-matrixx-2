/**
 * Keyword-triggered compress directive policy (pure).
 *
 * Soft trigger companion to the usage-based compress watchdog: when a
 * configured keyword appears in the last user message, the same compress
 * directive is injected. Shares cooldown and marker semantics with
 * `compress-watchdog.ts` — the caller owns the shared state.
 *
 * No I/O, no timers: safe to unit test in isolation.
 */

import {
  COMPRESS_WATCHDOG_MARKER,
  type CompressWatchdogConfig,
} from "./compress-watchdog"

/** Config consumed by the keyword trigger (built from `dcp.watchdog.keywordTrigger`). */
export interface KeywordCompressTriggerConfig {
  enabled: boolean
  keywords: string[]
}

/** Partial form as it arrives from `matrixx.jsonc` (Zod defaults may be absent). */
export type KeywordCompressTriggerConfigInput = Partial<KeywordCompressTriggerConfig>

export const DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG: KeywordCompressTriggerConfig = {
  enabled: true,
  keywords: ["dcp-compress", "compress context", "run dcp"],
}

const MAX_KEYWORDS = 16
const MAX_KEYWORD_LENGTH = 64

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function toKeywordPattern(keyword: string): RegExp {
  const collapsed = keyword
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join("\\s+")
  return new RegExp(`\\b${collapsed}\\b`, "i")
}

/**
 * Normalize a partial config into a usable one. Trims entries, drops empties,
 * dedupes case-insensitively preserving the first occurrence, drops entries
 * longer than 64 chars, and caps the list at 16 keywords.
 */
export function resolveKeywordCompressTriggerConfig(
  input?: KeywordCompressTriggerConfigInput | undefined,
): KeywordCompressTriggerConfig {
  if (input === undefined) return { ...DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG, keywords: [...DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG.keywords] }
  const seen = new Set<string>()
  const keywords: string[] = []
  const source = input.keywords ?? DEFAULT_KEYWORD_COMPRESS_TRIGGER_CONFIG.keywords
  for (const raw of source) {
    if (typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_KEYWORD_LENGTH) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(trimmed)
    if (keywords.length >= MAX_KEYWORDS) break
  }
  return {
    enabled: input.enabled ?? true,
    keywords,
  }
}

/** True when any configured keyword appears in the text (word-boundary match). */
export function matchesCompressKeyword(text: string, keywords: readonly string[]): boolean {
  if (!text || keywords.length === 0) return false
  for (const keyword of keywords) {
    const trimmed = keyword.trim()
    if (trimmed.length === 0) continue
    if (toKeywordPattern(trimmed).test(text)) return true
  }
  return false
}

export interface ShouldInjectForKeywordArgs {
  config: KeywordCompressTriggerConfig
  lastUserText?: string | undefined
  turnsSinceLastInjection: number
  /** Cooldown shared with the usage-based watchdog. */
  cooldownTurns: CompressWatchdogConfig["cooldownTurns"]
}

export function shouldInjectForKeyword(args: ShouldInjectForKeywordArgs): boolean {
  const { config, lastUserText, turnsSinceLastInjection, cooldownTurns } = args
  if (!config.enabled) return false
  if (!lastUserText) return false
  if (turnsSinceLastInjection < cooldownTurns) return false
  if (lastUserText.includes(COMPRESS_WATCHDOG_MARKER)) return false
  if (!matchesCompressKeyword(lastUserText, config.keywords)) return false
  return true
}
