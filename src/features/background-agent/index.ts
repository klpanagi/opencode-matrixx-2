/** Background-execution cross-link (separate layers, not moved in Phase 4):
 * - `features/background-agent/` owns agent handle files and lifecycle management.
 * - `hooks/background-notification/` observes session events and emits notifications.
 * - `hooks/background-task-blocker/` guards tool execution while background tasks run.
 * - `tools/background-task/` exposes agent-callable task controls (cancel/output/revive).
 */
export {
  BG_HANDLE_FILE_PREFIX,
  type BgHandle,
  BgHandleSchema,
  deleteHandleFile,
  getBgHandleDir,
  getHandlePath,
  readHandles,
  sweepStaleHandles,
  toHandle,
  writeHandle,
} from "./handle-index"
export { BackgroundManager, type OnSubagentSessionCreated, type SubagentSessionCreatedEvent } from "./manager"
export { TaskStateManager } from "./state"
export { TaskHistory, type TaskHistoryEntry } from "./task-history"
export * from "./types"
