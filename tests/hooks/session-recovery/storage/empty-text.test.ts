import { afterEach, describe, expect, it, vi } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../../../../src/hooks/session-recovery/constants"
import { replaceEmptyTextParts } from "../../../../src/hooks/session-recovery/storage"

vi.mock("../../../../src/shared/config/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const SESSION_ID = "ses_t9_empty_text"
const MESSAGE_ID = "msg_t9_empty_text"
const PART_ID = "prt_t9_empty_text"
const partDir = join(PART_STORAGE, MESSAGE_ID)
const partPath = join(partDir, `${PART_ID}.json`)
const REPLACEMENT = "recovered content"

function seedEmptyTextPart(): void {
  mkdirSync(partDir, { recursive: true })
  const part = {
    id: PART_ID,
    sessionID: SESSION_ID,
    messageID: MESSAGE_ID,
    type: "text",
    text: "",
    synthetic: false,
  }
  writeFileSync(partPath, JSON.stringify(part, null, 2))
}

afterEach(() => {
  if (existsSync(partDir)) {
    rmSync(partDir, { recursive: true, force: true })
  }
})

describe("replaceEmptyTextParts JSON writes", () => {
  it("writes minified valid JSON asynchronously with the same keys", async () => {
    //#given a stored text part with empty content in 2-space indented JSON
    seedEmptyTextPart()
    const before = JSON.parse(readFileSync(partPath, "utf-8")) as Record<string, unknown>
    const beforeKeys = Object.keys(before).sort()

    //#when replacing the empty text parts
    const replaced = await replaceEmptyTextParts(MESSAGE_ID, REPLACEMENT)

    //#then the replacement is persisted as compact JSON with identical keys
    expect(replaced).toBe(true)
    const raw = readFileSync(partPath, "utf-8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.text).toBe(REPLACEMENT)
    expect(parsed.synthetic).toBe(true)
    expect(Object.keys(parsed).sort()).toEqual(beforeKeys)
    expect(raw).toBe(JSON.stringify(parsed))
    expect(raw).not.toContain("\n")
  })

  it("writes fewer bytes than the previous 2-space indented encoding", async () => {
    //#given a stored text part with empty content in 2-space indented JSON
    seedEmptyTextPart()
    const before = JSON.parse(readFileSync(partPath, "utf-8")) as Record<string, unknown>
    const indentedBytes = Buffer.byteLength(JSON.stringify(before, null, 2))

    //#when replacing the empty text parts
    await replaceEmptyTextParts(MESSAGE_ID, REPLACEMENT)

    //#then the rewritten file is smaller while remaining parseable
    const writtenBytes = Buffer.byteLength(readFileSync(partPath, "utf-8"))
    expect(writtenBytes).toBeLessThan(indentedBytes)
  })
})
