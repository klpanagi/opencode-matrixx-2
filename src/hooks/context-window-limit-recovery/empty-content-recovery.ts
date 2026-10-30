import { notify } from "../../shared/notify"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { contentOf, idOf } from "../../shared/session-message"
import {
  findEmptyMessageByIndex,
  findEmptyMessages,
  injectTextPart,
  injectTextPartAsync,
  replaceEmptyTextParts,
  replaceEmptyTextPartsAsync,
} from "../session-recovery/storage"
import type { Client } from "./client"
import { PLACEHOLDER_TEXT } from "./message-builder"
import { incrementEmptyContentAttempt } from "./state"
import type { AutoCompactState } from "./types"


async function fixFile(sessionID: string, messageIndex?: number): Promise<{ fixed: boolean; ids: string[] }> {
  const ids: string[] = []
  let fixed = false
  if (messageIndex !== undefined) {
    const target = findEmptyMessageByIndex(sessionID, messageIndex)
    if (target) {
      if (replaceEmptyTextParts(target, PLACEHOLDER_TEXT) || injectTextPart(sessionID, target, PLACEHOLDER_TEXT)) {
        fixed = true
        ids.push(target)
      }
    }
  }
  if (!fixed) {
    for (const mid of findEmptyMessages(sessionID)) {
      if (replaceEmptyTextParts(mid, PLACEHOLDER_TEXT) || injectTextPart(sessionID, mid, PLACEHOLDER_TEXT)) {
        fixed = true
        ids.push(mid)
      }
    }
  }
  return { fixed, ids }
}

async function fixSdk(client: Client, sessionID: string): Promise<{ fixed: boolean; ids: string[] }> {
  const ids: string[] = []
  let fixed = false
  const emptyIds = await findEmptyMessagesSdk(client, sessionID)
  for (const mid of emptyIds) {
    if ((await replaceEmptyTextPartsAsync(client, sessionID, mid, PLACEHOLDER_TEXT)) || (await injectTextPartAsync(client, sessionID, mid, PLACEHOLDER_TEXT))) {
      fixed = true
      ids.push(mid)
    }
  }
  return { fixed, ids }
}

async function findEmptyMessagesSdk(client: Client, sessionID: string): Promise<string[]> {
  try {
    const msgs = await fetchSessionMessages(client, sessionID)
    const empty: string[] = []
    for (const m of msgs) {
      const id = idOf(m)
      const content = contentOf(m)
      if (!id || content.length === 0) continue
      const hasContent = content.some((p) => {
        if (p.type === "text") return !!p.text?.trim()
        if (p.type === "tool" || p.type === "tool_use" || p.type === "tool_result") return true
        if (p.type === "thinking" || p.type === "redacted_thinking" || p.type === "meta") return false
        return true
      })
      if (!hasContent) empty.push(id)
    }
    return empty
  } catch {
    return []
  }
}

export async function fixEmptyMessages(params: { sessionID: string; autoCompactState: AutoCompactState; client: Client; messageIndex?: number }): Promise<boolean> {
  incrementEmptyContentAttempt(params.autoCompactState, params.sessionID)
  const result = isSqliteBackend() ? await fixSdk(params.client, params.sessionID) : await fixFile(params.sessionID, params.messageIndex)
  if (!result.fixed) {
    const emptyCount = isSqliteBackend() ? (await findEmptyMessagesSdk(params.client, params.sessionID)).length : findEmptyMessages(params.sessionID).length
    if (emptyCount === 0) notify("error", "Empty Content Error: No empty messages found in storage. Cannot auto-recover.")
    return false
  }
  notify("warn", `Session Recovery: Fixed ${result.ids.length} empty message(s). Retrying...`)
  return true
}
