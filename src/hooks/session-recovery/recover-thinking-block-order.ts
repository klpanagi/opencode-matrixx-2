import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import type { SessionDomainLike } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { contentOf, idOf, isAssistant } from "../../shared/session-message"
import { THINKING_TYPES } from "./constants"
import { extractMessageIndex } from "./detect-error-type"
import { findMessageByIndexNeedingThinking, findMessagesWithOrphanThinking, prependThinkingPart } from "./storage"
import { prependThinkingPartAsync } from "./storage/thinking-prepend"
import type { MessageData } from "./types"

type Client = { session: SessionDomainLike }

function toPartsWithIds(message: unknown): Array<{ id: string; type: string }> {
  return contentOf(message).filter(
    (part): part is { id: string; type: string } =>
      typeof part.id === "string" && typeof part.type === "string",
  )
}

export async function recoverThinkingBlockOrder(
  client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData,
  _directory: string,
  error: unknown
): Promise<boolean> {
  if (isSqliteBackend()) {
    return recoverThinkingBlockOrderFromSDK(client, sessionID, error)
  }

  const targetIndex = extractMessageIndex(error)
  if (targetIndex !== null) {
    const targetMessageID = findMessageByIndexNeedingThinking(sessionID, targetIndex)
    if (targetMessageID) {
      return prependThinkingPart(sessionID, targetMessageID)
    }
  }

  const orphanMessages = findMessagesWithOrphanThinking(sessionID)
  if (orphanMessages.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of orphanMessages) {
    if (prependThinkingPart(sessionID, messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function recoverThinkingBlockOrderFromSDK(
  client: Client,
  sessionID: string,
  error: unknown
): Promise<boolean> {
  const targetIndex = extractMessageIndex(error)
  if (targetIndex !== null) {
    const targetMessageID = await findMessageByIndexNeedingThinkingFromSDK(client, sessionID, targetIndex)
    if (targetMessageID) {
      return prependThinkingPartAsync(client, sessionID, targetMessageID)
    }
  }

  const orphanMessages = await findMessagesWithOrphanThinkingFromSDK(client, sessionID)
  if (orphanMessages.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of orphanMessages) {
    if (await prependThinkingPartAsync(client, sessionID, messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function findMessagesWithOrphanThinkingFromSDK(
  client: Client,
  sessionID: string
): Promise<string[]> {
  let messages: MessageData[]
  try {
    messages = await fetchSessionMessages(client, sessionID)
  } catch {
    return []
  }

  const result: string[] = []
  for (const msg of messages) {
    const id = idOf(msg)
    if (!isAssistant(msg)) continue
    if (!id) continue

    const partsWithIds = toPartsWithIds(msg)
    if (partsWithIds.length === 0) continue

    const sortedParts = [...partsWithIds].sort((a, b) => a.id.localeCompare(b.id))
    const firstPart = sortedParts[0]
    if (!THINKING_TYPES.has(firstPart.type)) {
      result.push(id)
    }
  }

  return result
}

async function findMessageByIndexNeedingThinkingFromSDK(
  client: Client,
  sessionID: string,
  targetIndex: number
): Promise<string | null> {
  let messages: MessageData[]
  try {
    messages = await fetchSessionMessages(client, sessionID)
  } catch {
    return null
  }

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMessage = messages[targetIndex]
  const targetId = idOf(targetMessage)
  if (!isAssistant(targetMessage)) return null
  if (!targetId) return null

  const partsWithIds = toPartsWithIds(targetMessage)
  if (partsWithIds.length === 0) return null

  const sortedParts = [...partsWithIds].sort((a, b) => a.id.localeCompare(b.id))
  const firstPart = sortedParts[0]
  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  return firstIsThinking ? null : targetId
}
