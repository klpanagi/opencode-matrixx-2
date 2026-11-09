import { lookupSubagentParent } from "../../features/session-state/parent-registry"
import { fetchSyncResult } from "./sync-result-fetcher"
import { pollSyncSession } from "./sync-session-poller"

export type SyncContinuationDeps = {
  pollSyncSession: typeof pollSyncSession
  fetchSyncResult: typeof fetchSyncResult
  getParentSessionID?: typeof lookupSubagentParent
}

export const syncContinuationDeps: SyncContinuationDeps = {
  pollSyncSession,
  fetchSyncResult,
  getParentSessionID: lookupSubagentParent,
}
