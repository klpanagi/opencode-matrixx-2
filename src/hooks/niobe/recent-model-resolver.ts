import {
  findNearestMessageWithFields,
  findNearestMessageWithFieldsFromSDK,
} from "../../features/hook-message-injector"
import { getMessageDir, isSqliteBackend } from "../../shared"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import type { ModelInfo } from "./types"

export async function resolveRecentModelForSession(
  ctx: NativePluginContext,
  sessionID: string
): Promise<ModelInfo | undefined> {
  try {
    const messages = await fetchSessionMessages(ctx, sessionID)

    for (let i = messages.length - 1; i >= 0; i--) {
      const model = messages[i].model
      if (model?.providerID && model?.modelID) {
        return { providerID: model.providerID, modelID: model.modelID }
      }
    }
  } catch {
    // ignore - fallback to message storage
  }

  let currentMessage = null
  if (isSqliteBackend()) {
    currentMessage = await findNearestMessageWithFieldsFromSDK(ctx, sessionID)
  } else {
    const messageDir = getMessageDir(sessionID)
    currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
  }
  const model = currentMessage?.model
  if (!model?.providerID || !model?.modelID) {
    return undefined
  }
  return { providerID: model.providerID, modelID: model.modelID }
}
