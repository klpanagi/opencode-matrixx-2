import { sendSyncPrompt } from "./sync-prompt-sender"
import { fetchSyncResult } from "./sync-result-fetcher"
import { createSyncSession } from "./sync-session-creator"
import { pollSyncSession } from "./sync-session-poller"

export type SyncTaskDeps = {
  createSyncSession: typeof createSyncSession
  sendSyncPrompt: typeof sendSyncPrompt
  pollSyncSession: typeof pollSyncSession
  fetchSyncResult: typeof fetchSyncResult
  unregister?: (sessionID: string) => void
}

export const syncTaskDeps: SyncTaskDeps = {
  createSyncSession,
  sendSyncPrompt,
  pollSyncSession,
  fetchSyncResult,
}
