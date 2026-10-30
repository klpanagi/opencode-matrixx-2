import { log } from "../../shared/logger"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import type { SessionContextCarrier } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import type { ContentPart, } from "../../shared/session-message"
import { contentOf, idOf, isAssistant } from "../../shared/session-message"
import { findEmptyMessages, injectTextPart, replaceEmptyTextParts } from "../session-recovery/storage"
import { replaceEmptyTextPartsAsync } from "../session-recovery/storage/empty-text"
import { injectTextPartAsync } from "../session-recovery/storage/text-part-injector"

export const PLACEHOLDER_TEXT = "[user interrupted]"

function hasSdkContent(parts: ReadonlyArray<ContentPart>): boolean {
  if (parts.length === 0) return false
  for (const p of parts) {
    if (!p.type) continue
    if (p.type === "thinking" || p.type === "redacted_thinking" || p.type === "meta") continue
    if (p.type === "text") {
      if (p.text?.trim()) return true
      continue
    }
    if (p.type === "tool" || p.type === "tool_use" || p.type === "tool_result") return true
    return true
  }
  return false
}

async function findEmptyIdsSdk(client: SessionContextCarrier, sessionID: string): Promise<string[]> {
  try {
    const msgs = await fetchSessionMessages(client, sessionID)
    const empty: string[] = []
    for (const m of msgs) {
      const id = idOf(m)
      if (!id) continue
      if (!hasSdkContent(contentOf(m))) empty.push(id)
    }
    return empty
  } catch {
    return []
  }
}

export async function sanitizeEmptyMessagesBeforeSummarize(sessionID: string, client?: SessionContextCarrier): Promise<number> {
  if (client && isSqliteBackend()) {
    const ids = await findEmptyIdsSdk(client, sessionID)
    if (ids.length === 0) return 0
    let fixed = 0
    for (const mid of ids) {
      if ((await replaceEmptyTextPartsAsync(client, sessionID, mid, PLACEHOLDER_TEXT)) || (await injectTextPartAsync(client, sessionID, mid, PLACEHOLDER_TEXT))) fixed++
    }
    if (fixed > 0) log("[auto-compact] pre-summarize sanitization fixed empty messages", { sessionID, fixedCount: fixed, totalEmpty: ids.length })
    return fixed
  }
  const ids = findEmptyMessages(sessionID)
  if (ids.length === 0) return 0
  let fixed = 0
  for (const mid of ids) {
    if (replaceEmptyTextParts(mid, PLACEHOLDER_TEXT) || injectTextPart(sessionID, mid, PLACEHOLDER_TEXT)) fixed++
  }
  if (fixed > 0) log("[auto-compact] pre-summarize sanitization fixed empty messages", { sessionID, fixedCount: fixed, totalEmpty: ids.length })
  return fixed
}

export async function getLastAssistant(sessionID: string, client: SessionContextCarrier): Promise<Record<string, unknown> | null> {
  try {
    const data = await fetchSessionMessages(client, sessionID)
    const last = [...data].reverse().find((m) => isAssistant(m))
    if (!last) return null
    return last as Record<string, unknown>
  } catch {
    return null
  }
}
