export const MEMORY_DIR_NAME = ".matrixx" as const
export const MEMORY_SUBDIR_NAME = "memory" as const
export const MEMORY_FILE_NAME = "memory.jsonl" as const
export const MEMORY_LOCK_FILE_NAME = ".lock" as const

export const STALE_LOCK_THRESHOLD_MS = 30000 as const
export const LOCK_RETRY_COUNT = 4 as const

export const DEFAULT_PINNED = false as const
export const DEFAULT_REMOVED = false as const
export const DEFAULT_SCOPE = "session" as const

export const SYNTHETIC_MESSAGE_PREFIXES = [
  "<task-notification>",
  "<system-reminder>",
  "<context_guidance>",
  "<tool-result>",
] as const

export type SyntheticMessagePrefix = (typeof SYNTHETIC_MESSAGE_PREFIXES)[number]

export function isSyntheticMessage(text: string): boolean {
  const trimmed = text.trimStart()
  return SYNTHETIC_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}
