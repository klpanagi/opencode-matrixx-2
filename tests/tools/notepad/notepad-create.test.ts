/// <reference types="bun-types" />

/**
 * Task 2 — notepad_create tool (TDD RED).
 *
 * Contract:
 * - create-then-read roundtrip succeeds; file lives under tmp/.matrixx/notepads/<bucket>/
 * - double-create → {error: file_exists}, original content/mtime unchanged
 * - traversal / absolute fileName → invalid_file_path; bad bucket → invalid_plan_name
 * - created file contains the `**Task ID**` marker so `findNotepadForTask` locates it
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { findNotepadForTask, notepadsRootFor, taskIdMarkerLine } from "../../../src/tools/notepad/index"
import { createNotepadCreateTool } from "../../../src/tools/notepad/notepad-create"

const TEST_ABORT = new AbortController()

function testContext(testDir: string): ToolContext {
  return {
    sessionID: "test-session-notepad-create",
    messageID: "test-message-notepad-create",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
    worktree: testDir,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("notepad_create", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `notepad-create-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("create then read roundtrip inside the plan bucket", async () => {
    //#given a fresh tmp project dir
    const createTool = createNotepadCreateTool()

    //#when creating a notepad in a plan bucket
    const res = JSON.parse(
      await createTool.execute(
        { planName: "e2e-plan", fileName: "learnings.md", subject: "e2e probe", taskId: "T-e2e-1" },
        testContext(testDir),
      ),
    )

    //#then success with a filePath inside tmp/.matrixx/notepads/e2e-plan/
    expect(res.success).toBe(true)
    expect(res.filePath).toBe(join(testDir, ".matrixx", "notepads", "e2e-plan", "learnings.md"))
    expect(existsSync(res.filePath)).toBe(true)
    expect(readFileSync(res.filePath, "utf-8")).toContain(taskIdMarkerLine("T-e2e-1"))
  })

  test("double-create is rejected with file_exists and leaves content/mtime unchanged", async () => {
    //#given an existing notepad
    const createTool = createNotepadCreateTool()
    const ctx = testContext(testDir)
    const first = JSON.parse(
      await createTool.execute(
        { planName: "e2e-plan", fileName: "learnings.md", subject: "first", taskId: "T-dup-1" },
        ctx,
      ),
    )
    expect(first.success).toBe(true)
    const before = readFileSync(first.filePath, "utf-8")
    const beforeMtime = statSync(first.filePath).mtimeMs

    //#when creating the same notepad again
    const res = JSON.parse(
      await createTool.execute(
        { planName: "e2e-plan", fileName: "learnings.md", subject: "second", taskId: "T-dup-2" },
        ctx,
      ),
    )

    //#then file_exists and the original bytes/mtime are untouched
    expect(res.error).toBe("file_exists")
    expect(readFileSync(first.filePath, "utf-8")).toBe(before)
    expect(statSync(first.filePath).mtimeMs).toBe(beforeMtime)
  })

  test("created file is locatable via findNotepadForTask", async () => {
    //#given a tool-created notepad carrying a task-id marker
    const createTool = createNotepadCreateTool()
    const ctx = testContext(testDir)
    await createTool.execute(
      { planName: "e2e-plan", fileName: "learnings.md", subject: "locatable", taskId: "T-find-me" },
      ctx,
    )

    //#when the hook lookup scans for that task id
    const found = findNotepadForTask({
      // @ts-expect-error minimal ctx shape for the lookup
      ctx: { directory: testDir },
      task: { id: "T-find-me", subject: "locatable", metadata: { planName: "e2e-plan" } },
      notepadRoot: notepadsRootFor(testDir),
    })

    //#then it resolves to the tool-created file
    expect(found?.filePath).toBe(join(testDir, ".matrixx", "notepads", "e2e-plan", "learnings.md"))
  })

  test("traversal and absolute fileName values are rejected", async () => {
    //#given traversal / absolute payloads
    const createTool = createNotepadCreateTool()
    const ctx = testContext(testDir)

    //#when executed THEN invalid_file_path (never a write outside the bucket)
    for (const bad of ["../evil.md", "/tmp/evil.md", "sub/dir.md"]) {
      const res = JSON.parse(
        await createTool.execute({ planName: "e2e-plan", fileName: bad }, ctx),
      )
      expect(res.error).toBe("invalid_file_path")
    }
    expect(existsSync(join(testDir, ".matrixx", "notepads", "e2e-plan", "evil.md"))).toBe(false)
  })

  test("bad bucket surfaces invalid_plan_name", async () => {
    //#given a traversal bucket
    const createTool = createNotepadCreateTool()

    //#when executed THEN invalid_plan_name
    const res = JSON.parse(
      await createTool.execute({ planName: "../../etc", fileName: "learnings.md" }, testContext(testDir)),
    )
    expect(res.error).toBe("invalid_plan_name")
  })

  test("empty planName falls back to the adhoc bucket", async () => {
    //#given no plan name
    const createTool = createNotepadCreateTool()

    //#when executed THEN the adhoc bucket owns the file
    const res = JSON.parse(
      await createTool.execute({ fileName: "learnings.md", subject: "adhoc probe" }, testContext(testDir)),
    )
    expect(res.success).toBe(true)
    expect(res.filePath).toBe(join(testDir, ".matrixx", "notepads", "adhoc", "learnings.md"))
  })
})
