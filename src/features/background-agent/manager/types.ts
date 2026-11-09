import type { BackgroundTaskConfig } from "../../../config/schema"
import type { EffortConfig } from "../../../config/schema/effort"
import type { NativeDomains } from "../../../shared/session/session-context-source"
import type { TaskHistory } from "../task-history"
import type { ManagerStore } from "./store"

/** Handle returned by {@link ManagerTimers.setTimeout}. */
export type ManagerTimerHandle = ReturnType<typeof setTimeout>

/**
 * Injectable timer surface so lifecycle/reconcile code can run against a
 * deterministic clock in tests. Defaults to the global timer functions.
 */
export interface ManagerTimers {
  setTimeout(callback: () => void, delayMs?: number): ManagerTimerHandle
  clearTimeout(handle: ManagerTimerHandle): void
}

/**
 * Result of the launch-parent validation seam. `ok: false` carries the
 * user-facing rejection message; the caller throws it after validation so
 * `launch()` keeps returning `Promise<BackgroundTask>` for valid launches.
 */
export type LaunchResult = { ok: true } | { ok: false; error: string }

/**
 * Shared runtime handed to the lifecycle/reconcile function modules.
 * `BackgroundManager` satisfies this structurally; the function modules
 * never reach back into the class itself (no import cycle at runtime).
 */
export interface ManagerRuntime {
  readonly store: ManagerStore
  readonly native: NativeDomains
  readonly directory: string
  readonly config?: BackgroundTaskConfig
  readonly effortConfig?: EffortConfig
  readonly taskHistory: TaskHistory
  readonly now?: () => number
  readonly timers?: ManagerTimers
  readonly restoreReacquire?: boolean
  notify?: (payload: unknown) => void | Promise<void>
}


/**
 * Ephemeral native session descriptor (T1 unified-bg-native-tracking).
 *
 * Read-only view over the session-state registry — NOT a persisted bg_
 * handle. Uses the lightweight `subagentSessions`/`subagentParentMap`
 * registry (getSubagentSessionIDs + getParentSessionID) rather than the
 * heavier storage.ts SDK read path (getMainSessions/getAllSessions),
 * which requires directory-scoped sqlite/JSON access.
 */
export interface NativeDescendant {
  sessionId: string
  parentSessionId: string
  isChild: boolean
}


export type ResolveAnyResult =
  | { origin: "bg"; task: import("../types").BackgroundTask }
  | { origin: "ses" | "foreign"; sessionId: string; output: unknown; messages?: unknown }
  | { error: "not_found"; id: string }
