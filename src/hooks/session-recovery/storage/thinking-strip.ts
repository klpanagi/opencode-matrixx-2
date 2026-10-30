import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { deletePart, isSqliteBackend, log } from "../../../shared"
import type { SessionContextCarrier } from "../../../shared/session-context-source"
import { fetchSessionMessages } from "../../../shared/session-context-source"
import { contentOf, idOf } from "../../../shared/session-message"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import type { StoredPart } from "../types"

type OpencodeClient = SessionContextCarrier

export function stripThinkingParts(messageID: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: stripThinkingParts (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyRemoved = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart
      if (THINKING_TYPES.has(part.type)) {
        unlinkSync(filePath)
        anyRemoved = true
      }
    } catch {
    }
  }

  return anyRemoved
}

export async function stripThinkingPartsAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string
): Promise<boolean> {
  try {
    const messages = await fetchSessionMessages(client, sessionID)

    const targetMsg = messages.find((m) => idOf(m) === messageID)
    if (!targetMsg) return false

    let anyRemoved = false
    for (const part of contentOf(targetMsg)) {
      const partId = typeof part.id === "string" ? part.id : undefined
      if (part.type && THINKING_TYPES.has(part.type) && partId) {
        const deleted = await deletePart(client, sessionID, messageID, partId)
        if (deleted) anyRemoved = true
      }
    }

    return anyRemoved
  } catch (error) {
    log("[session-recovery] stripThinkingPartsAsync failed", { error: String(error) })
    return false
  }
}
