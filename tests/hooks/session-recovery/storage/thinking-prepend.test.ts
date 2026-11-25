import { afterEach, describe, expect, it, vi } from "bun:test"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../../../../src/hooks/session-recovery/constants"
import { prependThinkingPart } from "../../../../src/hooks/session-recovery/storage"

vi.mock("../../../../src/shared/config/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const SESSION_ID = "ses_t9_thinking_prepend"
const MESSAGE_ID = "msg_t9_thinking_prepend"
const partDir = join(PART_STORAGE, MESSAGE_ID)

function readSingleWrittenPart(): { raw: string; parsed: Record<string, unknown> } {
  const files = readdirSync(partDir).filter((file) => file.endsWith(".json"))
  expect(files).toHaveLength(1)
  const raw = readFileSync(join(partDir, files[0]), "utf-8")
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown> }
}

afterEach(() => {
  if (existsSync(partDir)) {
    rmSync(partDir, { recursive: true, force: true })
  }
})

describe("prependThinkingPart JSON writes", () => {
  it("writes minified valid JSON asynchronously with the same keys", async () => {
    //#given a message that needs a synthetic thinking part
    //#when prepending the thinking part
    const ok = await prependThinkingPart(SESSION_ID, MESSAGE_ID)

    //#then the write succeeds and persists compact JSON with identical keys
    expect(ok).toBe(true)
    const { raw, parsed } = readSingleWrittenPart()
    expect(Object.keys(parsed).sort()).toEqual([
      "id",
      "messageID",
      "sessionID",
      "synthetic",
      "thinking",
      "type",
    ])
    expect(parsed.type).toBe("thinking")
    expect(raw).toBe(JSON.stringify(parsed))
    expect(raw).not.toContain("\n")
  })

  it("writes fewer bytes than the previous 2-space indented encoding", async () => {
    //#given a message that needs a synthetic thinking part
    //#when prepending the thinking part
    await prependThinkingPart(SESSION_ID, MESSAGE_ID)

    //#then the compact encoding is smaller while remaining parseable
    const { raw, parsed } = readSingleWrittenPart()
    const indentedBytes = Buffer.byteLength(JSON.stringify(parsed, null, 2))
    const writtenBytes = Buffer.byteLength(raw)
    expect(writtenBytes).toBeLessThan(indentedBytes)
  })
})
