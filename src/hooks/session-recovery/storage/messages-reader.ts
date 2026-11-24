import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isSqliteBackend } from "../../../shared"
import { getMessageDir } from "../../../shared/opencode/opencode-message-dir"
import { log } from "../../../shared/runtime/logger"
import { isRecord } from "../../../shared/runtime/record-type-guard"
import type { SessionContextCarrier } from "../../../shared/session/session-context-source"
import { fetchSessionMessages } from "../../../shared/session/session-context-source"
import type { StoredMessageMeta } from "../types"


function normalizeSDKMessage(
  sessionID: string,
  value: unknown
): StoredMessageMeta | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string") return null

  const roleValue = value.role
  const role: StoredMessageMeta["role"] = roleValue === "assistant" ? "assistant" : "user"

  const created =
    isRecord(value.time) && typeof value.time.created === "number"
      ? value.time.created
      : 0

  return {
    id: value.id,
    sessionID,
    role,
    time: { created },
  }
}

export function readMessages(sessionID: string): StoredMessageMeta[] {
  if (isSqliteBackend()) return []

  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: StoredMessageMeta[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    const filePath = join(messageDir, file)
    try {
      const content = readFileSync(filePath, "utf-8")
      messages.push(JSON.parse(content))
    } catch (error) {
      log("[session-recovery] unreadable message file skipped", {
        path: filePath,
        reason: error instanceof Error ? error.message : String(error),
        level: "warn",
      })
    }
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

export async function readMessagesFromSDK(
  client: SessionContextCarrier,
  sessionID: string
): Promise<StoredMessageMeta[]> {
  try {
    const data = await fetchSessionMessages(client, sessionID)

    const messages = data
      .map((msg): StoredMessageMeta | null => normalizeSDKMessage(sessionID, msg))
      .filter((msg): msg is StoredMessageMeta => msg !== null)

    return messages.sort((a, b) => {
      const aTime = a.time?.created ?? 0
      const bTime = b.time?.created ?? 0
      if (aTime !== bTime) return aTime - bTime
      return a.id.localeCompare(b.id)
    })
  } catch (error) {
    log("[session-recovery] SDK message read failed", {
      sessionID,
      reason: error instanceof Error ? error.message : String(error),
      level: "warn",
    })
    return []
  }
}
