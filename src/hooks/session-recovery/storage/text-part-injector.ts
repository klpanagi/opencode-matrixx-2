import { existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isSqliteBackend, log, patchPart } from "../../../shared"
import type { SessionContextCarrier } from "../../../shared/session/session-context-source"
import { PART_STORAGE } from "../constants"
import type { StoredTextPart } from "../types"
import { generatePartId } from "./part-id"


export async function injectTextPart(sessionID: string, messageID: string, text: string): Promise<boolean> {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: injectTextPart (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const partId = generatePartId()
  const part: StoredTextPart = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    // Compact async JSON write: drop 2-space indentation (~1.3x fewer bytes
    // on message/part metadata) and keep the event loop free. See PR #1837
    // (migrate hooks off sync JSON I/O).
    await writeFile(join(partDir, `${partId}.json`), JSON.stringify(part))
    return true
  } catch {
    return false
  }
}

export async function injectTextPartAsync(
  client: SessionContextCarrier,
  sessionID: string,
  messageID: string,
  text: string
): Promise<boolean> {
  const partId = generatePartId()
  const part: Record<string, unknown> = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    return await patchPart(client, sessionID, messageID, partId, part)
  } catch (error) {
    log("[session-recovery] injectTextPartAsync failed", { error: String(error) })
    return false
  }
}
