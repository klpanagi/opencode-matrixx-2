import { findNearestMessageWithFields, findNearestMessageWithFieldsFromSDK } from "../../features/context-injection/hook-bridge"
import { getMessageDir, isSqliteBackend } from "../../shared"
import type { SessionContextCarrier } from "../../shared/session/session-context-source"

export async function getLastAgentFromSession(
  sessionID: string,
  carrier?: SessionContextCarrier
): Promise<string | null> {
  let nearest = null

  if (isSqliteBackend() && carrier) {
    nearest = await findNearestMessageWithFieldsFromSDK(carrier, sessionID)
  } else {
    const messageDir = getMessageDir(sessionID)
    if (!messageDir) return null
    nearest = findNearestMessageWithFields(messageDir)
  }

  return nearest?.agent?.toLowerCase() ?? null
}
