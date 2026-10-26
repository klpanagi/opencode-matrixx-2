// Data-driven markers that identify DCP-injected sticky nudge / compressed-block text.
// The sanitizer never branches on a model name — it only matches these generic markers.
export const NUDGE_MARKERS: RegExp[] = [
  /<instruction\s+name=iteration_nudge>/i,
  /compressed block context:/i,
  // Bare (bN) alone over-matches citations/build numbers, so it is narrowed:
  // only match when adjacent (within ~40 chars) to compress/iteration_nudge/sticky.
  // Out-of-element prose otherwise passes through byte-identical (control element
  // drop in sanitizeKnownTags covers DCP compressed-block prose).
  /(?:compress|iteration_nudge|sticky)[\s\S]{0,40}\(b\d+\)|\(b\d+\)[\s\S]{0,40}(?:compress|iteration_nudge|sticky)/i,
]

// Trim-only normalization: strip surrounding whitespace of a kept nudge part.
// Never collapse interior whitespace — collapsing mangles fenced code blocks.
// Non-nudge parts are never rewritten.
export function normalizeNudgeText(text: string): string {
  return text.trim()
}

// A kept nudge that orders `compress` unconditionally misfires in sessions where
// the tool was never granted (subagent sessions with DCP
// `experimental.allowSubAgents: false`, non-TUI runtimes that lack the tool).
// The guard below is appended once so the directive degrades to an explicit
// fallback instead of an impossible order. Matching is intentionally narrow:
// backticked `compress` or the phrase "compress tool" — never bare "compressed".
export const COMPRESS_TOOL_REFERENCE = /`compress`|compress tool/i

// Distinctive fragment of the appended guard — makes re-application idempotent.
const GUARD_APPLIED_MARKER = "state that explicitly and continue"

export const COMPRESS_AVAILABILITY_GUARD =
  "Only follow compress directives when your session actually exposes a `compress` tool; " +
  "if no such tool is available, state that explicitly and continue with the task instead of stopping."

// Already-conditional guidance ("if/when ... available/exposed/...") needs no guard.
const ALREADY_CONDITIONAL =
  /(?=.*\b(if|when|whether|unless|only when)\b)(?=.*\b(available|exposes?|exposed|present|granted|provided|exists?)\b)/is

export function guardCompressDirective(text: string): string {
  if (!COMPRESS_TOOL_REFERENCE.test(text)) return text
  if (text.includes(GUARD_APPLIED_MARKER)) return text
  if (ALREADY_CONDITIONAL.test(text)) return text
  return `${text} ${COMPRESS_AVAILABILITY_GUARD}`
}
