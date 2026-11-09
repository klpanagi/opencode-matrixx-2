import type { BackgroundTaskConfig } from "./background-task"

/**
 * Top-level `background_task` keys whose implementation was deleted. They stay
 * in the schema so existing configs keep loading, but no longer affect runtime.
 */
export const INERT_BACKGROUND_TASK_KEYS = [
  "defaultConcurrency",
  "providerConcurrency",
  "modelConcurrency",
  "staleTimeoutMs",
  "messageStalenessTimeoutMs",
  "maxToolCalls",
  "circuitBreaker",
  "wakeScheduler",
  "jobBoard",
  "wallClockAbortGraceMs",
] as const

export type InertBackgroundTaskKey = (typeof INERT_BACKGROUND_TASK_KEYS)[number]

let warned = false

/**
 * Emit at most one process-wide warning naming the inert keys present in the
 * parsed config. No-op when the config is absent or only live keys are set.
 */
export function warnDeprecatedBackgroundTaskKeys(config?: BackgroundTaskConfig | null): void {
  if (warned || config == null) return
  const present = INERT_BACKGROUND_TASK_KEYS.filter((key) => config[key] !== undefined)
  if (present.length === 0) return
  warned = true
  console.warn(
    `[matrixx] background_task config keys are deprecated and ignored: ${present.join(", ")}. Remove them from your matrixx config.`,
  )
}

export function _resetDeprecationWarningForTesting(): void {
  warned = false
}
