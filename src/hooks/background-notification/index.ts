/** Background-execution cross-link (separate layers, not moved in Phase 4):
 * - `features/background-agent/` owns agent handle files and lifecycle management.
 * - `hooks/background-notification/` observes session events and emits notifications.
 * - `hooks/background-task-blocker/` guards tool execution while background tasks run.
 * - `tools/background-task/` exposes agent-callable task controls (cancel/output/revive).
 */
/** background-notification barrel: explicit named re-exports of local modules only. */
export {
  createBackgroundNotificationHook,
} from "./hook"
export type {
  BackgroundNotificationHookConfig,
} from "./types"
