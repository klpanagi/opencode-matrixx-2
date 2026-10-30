import { log } from "../../shared/logger"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import type { SessionDomainLike } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { contentOf, idOf, isAssistant } from "../../shared/session-message"
import { THINKING_TYPES } from "./constants"
import { findMessagesWithThinkingBlocks, stripThinkingParts } from "./storage"
import { stripThinkingPartsAsync } from "./storage/thinking-strip"
import type { MessageData } from "./types"

type Client = { session: SessionDomainLike }

export async function recoverThinkingDisabledViolation(
  client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData
): Promise<boolean> {
  if (isSqliteBackend()) {
    return recoverThinkingDisabledViolationFromSDK(client, sessionID)
  }

  const messagesWithThinking = findMessagesWithThinkingBlocks(sessionID)
  if (messagesWithThinking.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of messagesWithThinking) {
    if (stripThinkingParts(messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function recoverThinkingDisabledViolationFromSDK(
  client: Client,
  sessionID: string
): Promise<boolean> {
  try {
    const messages = await fetchSessionMessages(client, sessionID)

    const messageIDsWithThinking: string[] = []
    for (const msg of messages) {
      const id = idOf(msg)
      if (!isAssistant(msg)) continue
      if (!id) continue

      const hasThinking = contentOf(msg).some((part) => part.type !== undefined && THINKING_TYPES.has(part.type))
      if (hasThinking) {
        messageIDsWithThinking.push(id)
      }
    }

    if (messageIDsWithThinking.length === 0) {
      return false
    }

    let anySuccess = false
    for (const messageID of messageIDsWithThinking) {
      if (await stripThinkingPartsAsync(client, sessionID, messageID)) {
        anySuccess = true
      }
    }

    return anySuccess
  } catch (error) {
    log("[session-recovery] recoverThinkingDisabledViolationFromSDK failed", {
      sessionID,
      error: String(error),
    })
    return false
  }
}
