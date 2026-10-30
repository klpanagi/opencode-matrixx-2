import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { isSqliteBackend, log, normalizeSDKResponse, patchPart } from "../../../shared"
import { contentOf, idOf } from "../../../shared/session-message"
import { PART_STORAGE } from "../constants"
import type { MessageData, StoredPart, StoredTextPart } from "../types"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"

type OpencodeClient = PluginInput["client"]

export function replaceEmptyTextParts(messageID: string, replacementText: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: replaceEmptyTextParts (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyReplaced = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart

      if (part.type === "text") {
        const textPart = part as StoredTextPart
        if (!textPart.text?.trim()) {
          textPart.text = replacementText
          textPart.synthetic = true
          writeFileSync(filePath, JSON.stringify(textPart, null, 2))
          anyReplaced = true
        }
      }
    } catch {
    }
  }

  return anyReplaced
}

export async function replaceEmptyTextPartsAsync(
  client: OpencodeClient,
  sessionID: string,
  messageID: string,
  replacementText: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })

    const targetMsg = messages.find((m) => idOf(m) === messageID)
    if (!targetMsg) return false

    let anyReplaced = false
    for (const part of contentOf(targetMsg)) {
      const partId = typeof part.id === "string" ? part.id : undefined
      if (part.type === "text" && !part.text?.trim() && partId) {
        const patched = await patchPart(client, sessionID, messageID, partId, {
          ...part,
          text: replacementText,
          synthetic: true,
        })
        if (patched) anyReplaced = true
      }
    }

    return anyReplaced
  } catch (error) {
    log("[session-recovery] replaceEmptyTextPartsAsync failed", { error: String(error) })
    return false
  }
}

export function findMessagesWithEmptyTextParts(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    const parts = readParts(msg.id)
    const hasEmptyTextPart = parts.some((part) => {
      if (part.type !== "text") return false
      const textPart = part as StoredTextPart
      return !textPart.text?.trim()
    })

    if (hasEmptyTextPart) {
      result.push(msg.id)
    }
  }

  return result
}

export async function findMessagesWithEmptyTextPartsFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<string[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    const result: string[] = []

    for (const msg of messages) {
      const id = idOf(msg)
      if (!id) continue
      const hasEmpty = contentOf(msg).some((p) => p.type === "text" && !p.text?.trim())
      if (hasEmpty) result.push(id)
    }

    return result
  } catch {
    return []
  }
}
