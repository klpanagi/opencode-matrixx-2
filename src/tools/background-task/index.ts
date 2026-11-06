/** Background-execution cross-link (separate layers, not moved in Phase 4):
 * - `features/background-agent/` owns agent handle files and lifecycle management.
 * - `hooks/background-notification/` observes session events and emits notifications.
 * - `hooks/background-task-blocker/` guards tool execution while background tasks run.
 * - `tools/background-task/` exposes agent-callable task controls (cancel/output/revive).
 */
export * from "./constants"
export {
  createBackgroundCancel,
  createBackgroundOutput,
  createBackgroundRevive,
  createBackgroundWaitAll,
} from "./tools"
export type * from "./types"
