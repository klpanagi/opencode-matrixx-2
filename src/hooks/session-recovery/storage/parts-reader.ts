import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isSqliteBackend } from "../../../shared"
import type { SessionContextCarrier } from "../../../shared/session-context-source"
import { PART_STORAGE } from "../constants"
import type { StoredPart } from "../types"

export function readParts(messageID: string): StoredPart[] {
  if (isSqliteBackend()) return []

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: StoredPart[] = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(partDir, file), "utf-8")
      parts.push(JSON.parse(content))
    } catch {
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
