import { hasSystemReminder, PRESENTATIONAL_TAGS } from "../../shared/system-directive"

export const MEMORY_DIR_NAME = ".matrixx" as const
export const MEMORY_SUBDIR_NAME = "memory" as const
export const MEMORY_FILE_NAME = "memory.jsonl" as const
export const MEMORY_LOCK_FILE_NAME = ".lock" as const

export const STALE_LOCK_THRESHOLD_MS = 30000 as const
export const LOCK_RETRY_COUNT = 4 as const

export const DEFAULT_PINNED = false as const
export const DEFAULT_REMOVED = false as const
export const DEFAULT_SCOPE = "session" as const

// System-reminder prefix resolved from the shared closed table
// (PRESENTATIONAL_TAGS) so no forked literal lives here.
const SHARED_REMINDER_TAG = PRESENTATIONAL_TAGS.find((tag) => tag.endsWith("reminder")) as string
const SHARED_REMINDER_PREFIX = `<${SHARED_REMINDER_TAG}>` as const

export const SYNTHETIC_MESSAGE_PREFIXES = [
  "<task-notification>",
  SHARED_REMINDER_PREFIX,
  "<context_guidance>",
  "<tool-result>",
] as const

export type SyntheticMessagePrefix = (typeof SYNTHETIC_MESSAGE_PREFIXES)[number]

/**
 * True-synthetic gate: startsWith on the known prefixes (kept for true
 * synthetic only) plus the shared closed-table helper for control
 * elements and paired presentational blocks.
 * Text-only: callers pass payload strings (input.text / blob).
 */
export function isSyntheticMessage(text: string): boolean {
  const trimmed = text.trimStart()
  if (SYNTHETIC_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true
  return hasSystemReminder(text)
}
