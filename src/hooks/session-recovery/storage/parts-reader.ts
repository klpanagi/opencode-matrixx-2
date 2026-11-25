import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isSqliteBackend } from "../../../shared"
import { log } from "../../../shared/runtime/logger"
import type { SessionContextCarrier } from "../../../shared/session/session-context-source"
import { PART_STORAGE } from "../constants"
import type { StoredPart } from "../types"

export function readParts(messageID: string): StoredPart[] {
  if (isSqliteBackend()) return []

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: StoredPart[] = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    const filePath = join(partDir, file)
    try {
      const content = readFileSync(filePath, "utf-8")
      parts.push(JSON.parse(content))
    } catch (error) {
      log("[session-recovery] unreadable part file skipped", {
        path: filePath,
        reason: error instanceof Error ? error.message : String(error),
        level: "warn",
      })
    }
  }

  return parts
}

export async function readPartsFromSDK(
  _client: SessionContextCarrier,
  _sessionID: string,
  _messageID: string,
): Promise<StoredPart[]> {
  return []
}
