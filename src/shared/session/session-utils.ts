import { findNearestMessageWithFields, findNearestMessageWithFieldsFromSDK } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/session-state/state"
import { getAgentConfigKey } from "../agent/agent-display-names"
import { isSqliteBackend } from "../config/opencode-storage-detection"
import { getMessageDir } from "../opencode/opencode-message-dir"
import { log } from "../runtime/logger"
import type { SessionContextCarrier } from "./session-context-source"

export async function isCallerOrchestrator(sessionID?: string, carrier?: SessionContextCarrier): Promise<boolean> {
  if (!sessionID) return false

  // In-memory session agent is already authoritative for the live session
  // (set by chat.message). Checking it first makes this O(1) for every
  // non-niobe agent instead of a full-transcript fetch.
  const knownAgent = getSessionAgent(sessionID)
  if (knownAgent) {
    return getAgentConfigKey(knownAgent) === "niobe"
  }

  if (isSqliteBackend() && carrier) {
    try {
      const nearest = await findNearestMessageWithFieldsFromSDK(carrier, sessionID)
      return getAgentConfigKey(nearest?.agent ?? "") === "niobe"
    } catch (error) {
      log("[session-utils] SDK orchestrator check failed", { sessionID, error: String(error) })
      return false
    }
  }

  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return getAgentConfigKey(nearest?.agent ?? "") === "niobe"
}
