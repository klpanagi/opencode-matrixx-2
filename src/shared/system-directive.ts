/**
 * Unified system directive prefix for matrixx internal messages.
 * All system-generated messages should use this prefix for consistent filtering.
 *
 * Format: [SYSTEM DIRECTIVE: MATRIXX - {TYPE}]
 */

export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: MATRIXX"

/**
 * Creates a system directive header with the given type.
 * @param type - The directive type (e.g., "TODO CONTINUATION", "MATRIX LOOP")
 * @returns Formatted directive string like "[SYSTEM DIRECTIVE: MATRIXX - TODO CONTINUATION]"
 */
export function createSystemDirective(type: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${type}]`
}

/**
 * Checks if a message starts with the matrixx system directive prefix.
 * Used by keyword-detector and other hooks to skip system-generated messages.
 * @param text - The message text to check
 * @returns true if the message is a system directive
 */
export function isSystemDirective(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX)
}

// ---------------------------------------------------------------------------
// Closed known-tag table (generic tag passthrough).
//
// Two disjoint classes, no open-ended strip-all regex:
// - CONTROL (drop element including inner text): <instruction name=iteration_nudge>.
//   DCP compressed-block prose travels inside the iteration_nudge element, so
//   the element drop covers it. Bare (bN) markers and prose outside a known
//   element are left byte-identical (narrow-or-drop is a Task 5 decision).
// - PRESENTATIONAL (unwrap, keep inner text): analysis, results, files,
//   answer, next_steps, system-reminder (case-insensitive).
// - UNKNOWN tags (e.g. <foo>) are left byte-identical.
//
// Pure constants + pure helper; no hook logic, no side effects.
// Whitespace policy: never collapse interior whitespace; trim only at the
// edges and only when stripping actually changed the text.
// ---------------------------------------------------------------------------

/** Paired <instruction name=iteration_nudge>...</instruction> element (case-insensitive). */
const CONTROL_PAIRED_PATTERN =
  /<instruction\b[^>]*\bname\s*=\s*(?:"iteration_nudge"|'iteration_nudge'|iteration_nudge(?=[\s/>]))[^>]*>[\s\S]*?<\/instruction\s*>/gi

/** Same paired element with inner text captured (group 1) for unwrap-keep-inner. */
const CONTROL_PAIRED_INNER_PATTERN =
  /<instruction\b[^>]*\bname\s*=\s*(?:"iteration_nudge"|'iteration_nudge'|iteration_nudge(?=[\s/>]))[^>]*>([\s\S]*?)<\/instruction\s*>/gi

/** Lone or self-closing <instruction name=iteration_nudge ...> opening tag (case-insensitive). */
const CONTROL_OPEN_TAG_PATTERN =
  /<instruction\b[^>]*\bname\s*=\s*(?:"iteration_nudge"|'iteration_nudge'|iteration_nudge(?=[\s/>]))[^>]*>/gi

/** Presentational tags: unwrap, keep inner text (case-insensitive). */
export const PRESENTATIONAL_TAGS = [
  "analysis",
  "results",
  "files",
  "answer",
  "next_steps",
  "system-reminder",
] as const

function unwrapTagPattern(tag: string): { open: RegExp; close: RegExp } {
  return {
    open: new RegExp(`<${tag}\\b[^>]*>`, "gi"),
    close: new RegExp(`</${tag}\\s*>`, "gi"),
  }
}

/** Legacy system-reminder drop pattern (exact; no attributes). */
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/gi

export interface SanitizeKnownTagsOptions {
  /**
   * How to handle CONTROL (<instruction name=iteration_nudge>) elements.
   * - "drop" (default): remove element including inner text. Used by keyword
   *   detectors so control inner prose cannot leak mode keywords.
   * - "unwrap-keep-inner": strip the element tags but keep inner prose.
   *   Used by the DCP nudge sanitizer kept-nudge path so the kept part is
   *   never sanitized to "" (guard + normalize then apply to inner prose).
   */
  control?: "drop" | "unwrap-keep-inner"
  /**
   * How to handle PRESENTATIONAL tags (analysis, results, files, answer,
   * next_steps, system-reminder).
   * - "unwrap" (default): strip tags but keep inner text. Used by the DCP
   *   nudge sanitizer kept-nudge path so kept prose is preserved.
   * - "drop": remove paired element including inner text. Used by keyword
   *   detectors so system-reminder inner keywords cannot leak into mode
   *   triggering.
   */
  presentation?: "unwrap" | "drop"
}

/**
 * Sanitizes known tags in text using the closed table above.
 * Control elements are dropped with inner text by default; presentational tags
 * are unwrapped keeping inner text; unknown tags pass through byte-identical.
 * @param text - The message text to sanitize
 * @param options - Optional control-element handling (default drop)
 * @returns sanitized text (trimmed at edges only when stripping changed it)
 */
export function sanitizeKnownTags(text: string, options?: SanitizeKnownTagsOptions): string {
  const control = options?.control ?? "drop"
  const presentation = options?.presentation ?? "unwrap"
  let out: string
  if (control === "unwrap-keep-inner") {
    out = text.replace(CONTROL_PAIRED_INNER_PATTERN, "$1")
    out = out.replace(CONTROL_OPEN_TAG_PATTERN, "")
  } else {
    out = text.replace(CONTROL_PAIRED_PATTERN, "")
    out = out.replace(CONTROL_OPEN_TAG_PATTERN, "")
  }
  for (const tag of PRESENTATIONAL_TAGS) {
    if (presentation === "drop") {
      const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi")
      out = out.replace(paired, "")
    }
    const { open, close } = unwrapTagPattern(tag)
    out = out.replace(open, "").replace(close, "")
  }
  return out === text ? text : out.trim()
}

/**
 * Checks if a message contains system-generated content that should be excluded
 * from keyword detection and mode triggering.
 * @param text - The message text to check
 * @returns true if the message contains system-reminder tags
 */
export function hasSystemReminder(text: string): boolean {
  SYSTEM_REMINDER_PATTERN.lastIndex = 0
  CONTROL_OPEN_TAG_PATTERN.lastIndex = 0
  return SYSTEM_REMINDER_PATTERN.test(text) || CONTROL_OPEN_TAG_PATTERN.test(text)
}

/**
 * Removes system-reminder tag content from text.
 * This prevents automated system messages from triggering mode keywords.
 * Drop (not unwrap): inner content must not leak into keyword detection.
 * @param text - The message text to clean
 * @returns text with system-reminder content removed
 */
export function removeSystemReminders(text: string): string {
  return text.replace(SYSTEM_REMINDER_PATTERN, "").trim()
}

export const SystemDirectiveTypes = {
  TASK_CONTINUATION: "TASK CONTINUATION",
  MATRIX_LOOP: "MATRIX LOOP",
  MISSION_CONTINUATION: "MISSION CONTINUATION",
  DELEGATION_REQUIRED: "DELEGATION REQUIRED",
  SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
  COMPACTION_CONTEXT: "COMPACTION CONTEXT",
  CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
  ORACLE_READ_ONLY: "ORACLE READ-ONLY",
} as const
