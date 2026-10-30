/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxToolContext } from "../../../src/tools/shared/define-tool"
import { createNotepadCreateTool } from "../../../src/tools/notepad/notepad-create"
import { createNotepadReadTool } from "../../../src/tools/notepad/notepad-read"

const TEST_ABORT = new AbortController()

function testContext(testDir: string): MatrixxToolContext {
  return {
    sessionID: "test-session-notepad-read",
    messageID: "test-message-notepad-read",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
    worktree: testDir,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("notepad_read", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `notepad-read-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("create-then-read roundtrip returns the stored content", async () => {
    //#given a notepad written via notepad_create
    const createTool = createNotepadCreateTool()
    const readTool = createNotepadReadTool()
    const ctx = testContext(testDir)
    const created = JSON.parse(
      await createTool.execute(
        { planName: "e2e-plan", fileName: "learnings.md", subject: "roundtrip", taskId: "T-rt-1" },
        ctx,
      ),
    )
    expect(created.success).toBe(true)

    //#when read back
    const res = JSON.parse(
      await readTool.execute({ planName: "e2e-plan", fileName: "learnings.md" }, ctx),
    )

    //#then the stored content (template heading + task marker) is returned
    expect(res.error).toBeUndefined()
    expect(res.filePath).toBe(join(testDir, ".matrixx", "notepads", "e2e-plan", "learnings.md"))
    expect(res.content).toContain("# Task: roundtrip")
    expect(res.content).toContain("**Task ID**: T-rt-1")
  })

  test("reading a missing file returns not_found", async () => {
    //#given no notepad on disk
    const readTool = createNotepadReadTool()

    //#when read
    const res = JSON.parse(
      await readTool.execute({ planName: "e2e-plan", fileName: "missing.md" }, testContext(testDir)),
    )

    //#then not_found
    expect(res.error).toBe("not_found")
  })

  test("traversal and absolute fileName values are rejected", async () => {
    //#given traversal / absolute payloads
    const readTool = createNotepadReadTool()
    const ctx = testContext(testDir)

    //#when executed THEN invalid_file_path
    for (const bad of ["../evil.md", "/tmp/evil.md"]) {
      const res = JSON.parse(await readTool.execute({ planName: "e2e-plan", fileName: bad }, ctx))
      expect(res.error).toBe("invalid_file_path")
    }
  })

  test("bad bucket surfaces invalid_plan_name", async () => {
    //#given a traversal bucket
    const readTool = createNotepadReadTool()

    //#when executed THEN invalid_plan_name
    const res = JSON.parse(
      await readTool.execute({ planName: "../../etc", fileName: "learnings.md" }, testContext(testDir)),
    )
    expect(res.error).toBe("invalid_plan_name")
  })

  test("offset/limit paginates the stored lines", async () => {
    //#given a multi-line notepad
    const createTool = createNotepadCreateTool()
    const readTool = createNotepadReadTool()
    const ctx = testContext(testDir)
    await createTool.execute(
      { planName: "e2e-plan", fileName: "learnings.md", subject: "paged", taskId: "T-page-1" },
      ctx,
    )

    //#when read with offset/limit
    const full = JSON.parse(
      await readTool.execute({ planName: "e2e-plan", fileName: "learnings.md" }, ctx),
    )
    const totalLines = (full.content as string).split("\n").length
    const page = JSON.parse(
      await readTool.execute({ planName: "e2e-plan", fileName: "learnings.md", offset: 2, limit: 3 }, ctx),
    )

    //#then exactly the requested window is returned
    expect(page.content).toBe((full.content as string).split("\n").slice(1, 4).join("\n"))
    expect(page.content.split("\n").length).toBe(Math.min(3, totalLines - 1))
  })

  test("present-but-invalid offset/limit is a validation_error", async () => {
    //#given a stored notepad
    const createTool = createNotepadCreateTool()
    const readTool = createNotepadReadTool()
    const ctx = testContext(testDir)
    await createTool.execute(
      { planName: "e2e-plan", fileName: "learnings.md", subject: "strict", taskId: "T-strict-1" },
      ctx,
    )

    //#when executed with offset 0 THEN validation_error (never a silent full-file fallback)
    const res = JSON.parse(
      await readTool.execute({ planName: "e2e-plan", fileName: "learnings.md", offset: 0 }, ctx),
    )
    expect(res.error).toBe("validation_error")
  })
})
