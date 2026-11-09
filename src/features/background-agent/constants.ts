export const TASK_TTL_MS = 30 * 60 * 1000
export const MIN_STABILITY_TIME_MS = 10 * 1000
export const DEFAULT_MAX_TOOL_CALLS = 4000
export const DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD = 20
export const DEFAULT_CIRCUIT_BREAKER_ENABLED = true
export const MIN_IDLE_TIME_MS = 5000
export const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 0
// Bound on the in-memory known-session set; the oldest entries are evicted
// (Set insertion order) once this many live sessions are remembered.
export const KNOWN_SESSIONS_MAX = 200

export interface EventProperties {
  sessionID?: string
  info?: { id?: string }
  [key: string]: unknown
}

export interface SubagentSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>
