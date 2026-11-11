export const REMOVED_TOOL_NAMES = [
  "task",
  "background_output",
  "background_cancel",
  "background_revive",
  "background_wait_all",
] as const

export type RemovedToolName = (typeof REMOVED_TOOL_NAMES)[number]
