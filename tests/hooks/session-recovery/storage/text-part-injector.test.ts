import { afterEach, describe, expect, it, vi } from "bun:test"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../../../../src/hooks/session-recovery/constants"
import { injectTextPart } from "../../../../src/hooks/session-recovery/storage"

vi.mock("../../../../src/shared/config/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const SESSION_ID = "ses_t9_text_part"
const MESSAGE_ID = "msg_t9_text_part"
const partDir = join(PART_STORAGE, MESSAGE_ID)
const TEXT = "Context injected for the next assistant turn."

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

describe("injectTextPart JSON writes", () => {
  it("writes minified valid JSON asynchronously with the same keys", async () => {
    //#given a message that needs a synthetic text part
    //#when injecting the text part
    const ok = await injectTextPart(SESSION_ID, MESSAGE_ID, TEXT)

    //#then the write succeeds and persists compact JSON with identical keys
    expect(ok).toBe(true)
    const { raw, parsed } = readSingleWrittenPart()
    expect(Object.keys(parsed).sort()).toEqual([
      "id",
      "messageID",
      "sessionID",
      "synthetic",
      "text",
      "type",
    ])
    expect(parsed.text).toBe(TEXT)
    expect(raw).toBe(JSON.stringify(parsed))
    expect(raw).not.toContain("\n")
  })

  it("writes fewer bytes than the previous 2-space indented encoding", async () => {
    //#given a message that needs a synthetic text part
    //#when injecting the text part
    await injectTextPart(SESSION_ID, MESSAGE_ID, TEXT)

    //#then the compact encoding is smaller while remaining parseable
    const { raw, parsed } = readSingleWrittenPart()
    const indentedBytes = Buffer.byteLength(JSON.stringify(parsed, null, 2))
    const writtenBytes = Buffer.byteLength(raw)
    expect(writtenBytes).toBeLessThan(indentedBytes)
  })
})
