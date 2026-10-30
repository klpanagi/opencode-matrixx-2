import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isSqliteBackend, log, patchPart } from "../../../shared"
import type { SessionContextCarrier } from "../../../shared/session-context-source"
import { fetchSessionMessages } from "../../../shared/session-context-source"
import { contentOf, idOf, isAssistant } from "../../../shared/session-message"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"


function findLastThinkingContent(sessionID: string, beforeMessageID: string): string {
  const messages = readMessages(sessionID)

  const currentIndex = messages.findIndex((message) => message.id === beforeMessageID)
  if (currentIndex === -1) return ""

  for (let i = currentIndex - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue

    const parts = readParts(message.id)
    for (const part of parts) {
      if (THINKING_TYPES.has(part.type)) {
        const thinking = (part as { thinking?: string; text?: string }).thinking
        const reasoning = (part as { thinking?: string; text?: string }).text
        const content = thinking || reasoning
        if (content && content.trim().length > 0) {
          return content
        }
      }
    }
  }

  return ""
}

export function prependThinkingPart(sessionID: string, messageID: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: prependThinkingPart (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const previousThinking = findLastThinkingContent(sessionID, messageID)

  const partId = `prt_0000000000_${messageID}_thinking`
  const part = {
    id: partId,
    sessionID,
    messageID,
    type: "thinking",
    thinking: previousThinking || "[Continuing from previous reasoning]",
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

async function findLastThinkingContentFromSDK(
  client: SessionContextCarrier,
  sessionID: string,
  beforeMessageID: string
): Promise<string> {
  try {
    const messages = await fetchSessionMessages(client, sessionID)

    const currentIndex = messages.findIndex((m) => idOf(m) === beforeMessageID)
    if (currentIndex === -1) return ""

    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!isAssistant(msg)) continue

      for (const part of contentOf(msg)) {
        if (part.type && THINKING_TYPES.has(part.type)) {
          const content = typeof part.thinking === "string" ? part.thinking : part.text
          if (content && content.trim().length > 0) return content
        }
      }
    }
  } catch {
    return ""
  }
  return ""
}

export async function prependThinkingPartAsync(
  client: SessionContextCarrier,
  sessionID: string,
  messageID: string
): Promise<boolean> {
  const previousThinking = await findLastThinkingContentFromSDK(client, sessionID, messageID)

  const partId = `prt_0000000000_${messageID}_thinking`
  const part: Record<string, unknown> = {
    id: partId,
    sessionID,
    messageID,
    type: "thinking",
    thinking: previousThinking || "[Continuing from previous reasoning]",
    synthetic: true,
  }

  try {
    return await patchPart(client, sessionID, messageID, partId, part)
  } catch (error) {
    log("[session-recovery] prependThinkingPartAsync failed", { error: String(error) })
    return false
  }
}
