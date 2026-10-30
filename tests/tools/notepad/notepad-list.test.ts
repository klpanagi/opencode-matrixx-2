/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxToolContext } from "../../../src/tools/shared/define-tool"
import { createNotepadListTool } from "../../../src/tools/notepad/notepad-list"

const TEST_ABORT = new AbortController()

function testContext(testDir: string): MatrixxToolContext {
  return {
    sessionID: "test-session-notepad-list",
    messageID: "test-message-notepad-list",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
    worktree: testDir,
    metadata: () => {},
    ask: async () => {},
  } as unknown as MatrixxToolContext
}

describe("notepad_list buckets + files", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `notepad-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, ".matrixx/notepads/notepad-tools"), { recursive: true })
    mkdirSync(join(testDir, ".matrixx/notepads/adhoc"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("without planName lists buckets", async () => {
    //#given two seeded buckets
    writeFileSync(join(testDir, ".matrixx/notepads/notepad-tools/learnings.md"), "# L\n")
    writeFileSync(join(testDir, ".matrixx/notepads/adhoc/learnings.md"), "# A\n")
    const listTool = createNotepadListTool()

    //#when listing without planName
    const res = JSON.parse(await listTool.execute({}, testContext(testDir)))

    //#then both buckets appear
    const names = (res.buckets as Array<{ bucket: string }>).map((b) => b.bucket)
    expect(names).toContain("notepad-tools")
    expect(names).toContain("adhoc")
  })

  test("with planName lists md files with mtime/size", async () => {
    //#given one file in the bucket
    writeFileSync(join(testDir, ".matrixx/notepads/notepad-tools/learnings.md"), "# L\nbody\n")
    const listTool = createNotepadListTool()

    //#when listing the bucket
    const res = JSON.parse(
      await listTool.execute({ planName: "notepad-tools" }, testContext(testDir)),
    )

    //#then entries carry mtime/size, kebab names only
    expect(Array.isArray(res.files)).toBe(true)
    expect(res.files.length).toBe(1)
    const entry = res.files[0]
    expect(entry.fileName).toBe("learnings.md")
    expect(typeof entry.filePath).toBe("string")
    expect(typeof entry.mtime).toBe("string")
    expect(typeof entry.mtimeMs).toBe("number")
    expect(typeof entry.size).toBe("number")
    expect(entry.size).toBeGreaterThan(0)
  })

  test("with planName on missing bucket returns empty files", async () => {
    //#given a bucket that does not exist on disk
    const listTool = createNotepadListTool()

    //#when listing it
    const res = JSON.parse(
      await listTool.execute({ planName: "no-such-bucket" }, testContext(testDir)),
    )

    //#then empty files array, no error
    expect(res.files).toEqual([])
  })

  test("rejects traversal planName", async () => {
    //#given a list tool
    const listTool = createNotepadListTool()

    //#when a traversal bucket is supplied
    const res = JSON.parse(
      await listTool.execute({ planName: "../etc" }, testContext(testDir)),
    )

    //#then invalid_plan_name
    expect(res.error).toBe("invalid_plan_name")
  })

  test("skips non-kebab md names with a skipped report", async () => {
    //#given a kebab file plus a non-kebab intruder
    writeFileSync(join(testDir, ".matrixx/notepads/notepad-tools/learnings.md"), "# L\n")
    writeFileSync(join(testDir, ".matrixx/notepads/notepad-tools/BAD_NAME.md"), "# bad\n")
    const listTool = createNotepadListTool()

    //#when listing the bucket
    const res = JSON.parse(
      await listTool.execute({ planName: "notepad-tools" }, testContext(testDir)),
    )

    //#then only kebab listed, intruder reported in skipped
    expect(res.files.map((f: { fileName: string }) => f.fileName)).toEqual(["learnings.md"])
    expect(Array.isArray(res.skipped)).toBe(true)
    expect(res.skipped[0].name).toBe("BAD_NAME.md")
  })
})
