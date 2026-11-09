export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "interrupt"
  | "stopped"
  | "statusUncertain"

/** Why a background task reached a terminal state (persisted on the handle). */
export type BackgroundTerminalReason =
  // compat-only: retained for handles persisted by older builds, no producer in current code
  | "queue-saturated"
  | "no-output"
  | "uncertain"
  | "aborted"
  | "stale"
  // compat-only: retained for handles persisted by older builds, no producer in current code
  | "nested-depth-exceeded"
  | "wall-clock-timeout"
  | "expired"

export interface ToolCallWindow {
  lastSignature: string
  consecutiveCount: number
  threshold: number
}

interface TaskProgress {
  toolCalls: number
  lastTool?: string
  toolCallWindow?: ToolCallWindow
  lastUpdate: Date
  lastMessage?: string
  lastMessageAt?: Date
  countedToolPartIDs?: Set<string>
}

export interface BackgroundTask {
  id: string
  sessionID?: string
  parentSessionID: string
  parentMessageID: string
  description: string
  prompt: string
  agent: string
  status: BackgroundTaskStatus
  queuedAt?: Date
  startedAt?: Date
  completedAt?: Date
  /** How this task entered the handle index: launched by delegation or adopted as a native subagent */
  origin?: "delegation" | "native"
  /** Last observed activity, projected to epoch ms on the handle */
  lastActivityAt?: Date
  /** Wall-clock deadline, projected to epoch ms on the handle */
  deadlineAt?: Date
  result?: string
  /** Short result summary persisted on the handle */
  resultSummary?: string
  error?: string
  progress?: TaskProgress
  parentModel?: { providerID: string; modelID: string }
  model?: { providerID: string; modelID: string; variant?: string; temperature?: number }
  /** Key used to dedupe re-launches of the same active delegation */
  concurrencyKey?: string
  /** Persisted group handle retained for compat; no longer gates admission */
  concurrencyGroup?: string
  /** Parent session's agent name for notification */
  parentAgent?: string
  /** Parent session's tool restrictions for notification prompts */
  parentTools?: Record<string, boolean>
  /** Marks if the task was launched from an unstable agent/category */
  isUnstableAgent?: boolean
  /** Category used for this task (e.g., 'bullet-time', 'construct') */
  category?: string

  /** Last message count for stability detection */
  lastMsgCount?: number
  /** Number of consecutive polls with stable message count */
  stablePolls?: number
  /** Why the task reached a terminal state (e.g. stopped/statusUncertain) */
  terminalReason?: BackgroundTerminalReason

  /** Compressed result payload for handoff to parent session (set by tryCompleteTask) */
  compactedResult?: string
  /** Monotonic epoch fencing token: bumped on revive/takeover, stale writers are rejected */
  generation?: number
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  parentTools?: Record<string, boolean>
  model?: { providerID: string; modelID: string; variant?: string; temperature?: number }
  isUnstableAgent?: boolean
  skills?: string[]
  skillContent?: string
  category?: string
}

export interface ResumeInput {
  sessionId: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  parentTools?: Record<string, boolean>
}

export interface ReviveInput {
  taskId?: string
  sessionId?: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  parentTools?: Record<string, boolean>
  force?: boolean
}
