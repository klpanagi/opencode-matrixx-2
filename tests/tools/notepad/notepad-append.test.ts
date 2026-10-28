/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createNotepadAppendTool } from "../../../src/tools/notepad/notepad-append"

const TEST_ABORT = new AbortController()

function testContext(testDir: string): ToolContext {
  return {
    sessionID: "test-session-notepad-append",
    messageID: "test-message-notepad-append",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
    worktree: testDir,
    metadata: () => {},
    ask: async () => {},
  } as unknown as ToolContext
}

describe("notepad_append APPEND-only", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `notepad-append-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, ".matrixx/notepads/notepad-tools"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("append grows file preserving prefix", async () => {
    //#given an existing notepad with v1 content
    const filePath = join(testDir, ".matrixx/notepads/notepad-tools/learnings.md")
    writeFileSync(filePath, "# Learnings\n\nv1\n")
    const appendTool = createNotepadAppendTool()

    //#when appending v2
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "notepad-tools", fileName: "learnings.md", content: "v2", taskId: "T-abc" },
        testContext(testDir),
      ),
    )

    //#then success, prefix preserved in order, bytesAppended reported
    expect(res.success).toBe(true)
    expect(res.filePath).toBe(filePath)
    expect(typeof res.bytesAppended).toBe("number")
    expect(res.bytesAppended).toBeGreaterThan(0)
    const after = readFileSync(filePath, "utf-8")
    expect(after.indexOf("v1")).toBeLessThan(after.indexOf("v2"))
    expect(after).toContain("v1")
    expect(after).toContain("v2")
    expect(after).toContain("T-abc")
  })

  test("append to missing file fails closed with not_found (no phantom creation)", async () => {
    //#given no file on disk
    const filePath = join(testDir, ".matrixx/notepads/notepad-tools/missing.md")
    expect(existsSync(filePath)).toBe(false)
    const appendTool = createNotepadAppendTool()

    //#when appending to the missing file
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "notepad-tools", fileName: "missing.md", content: "hello" },
        testContext(testDir),
      ),
    )

    //#then not_found and the file stays absent
    expect(res.error).toBe("not_found")
    expect(existsSync(filePath)).toBe(false)
  })

  test("append empty content fails validation", async () => {
    //#given an existing file
    const filePath = join(testDir, ".matrixx/notepads/notepad-tools/learnings.md")
    writeFileSync(filePath, "# Learnings\n")
    const before = readFileSync(filePath, "utf-8")
    const appendTool = createNotepadAppendTool()

    //#when appending empty/whitespace content
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "notepad-tools", fileName: "learnings.md", content: "   " },
        testContext(testDir),
      ),
    )

    //#then validation_error and file unchanged
    expect(res.error).toBe("validation_error")
    expect(readFileSync(filePath, "utf-8")).toBe(before)
  })

  test("append rejects traversal fileName", async () => {
    //#given an append tool
    const appendTool = createNotepadAppendTool()

    //#when a traversal payload is supplied
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "notepad-tools", fileName: "../evil.md", content: "x" },
        testContext(testDir),
      ),
    )

    //#then invalid_file_path
    expect(res.error).toBe("invalid_file_path")
  })

  test("append rejects traversal planName", async () => {
    //#given an append tool
    const appendTool = createNotepadAppendTool()

    //#when a traversal bucket is supplied
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "../etc", fileName: "learnings.md", content: "x" },
        testContext(testDir),
      ),
    )

    //#then invalid_plan_name
    expect(res.error).toBe("invalid_plan_name")
  })

  test("append rejects content over the 40k byte cap", async () => {
    //#given an existing file and oversized content
    const filePath = join(testDir, ".matrixx/notepads/notepad-tools/learnings.md")
    writeFileSync(filePath, "# Learnings\n")
    const before = readFileSync(filePath, "utf-8")
    const appendTool = createNotepadAppendTool()

    //#when appending >40k bytes
    const res = JSON.parse(
      await appendTool.execute(
        { planName: "notepad-tools", fileName: "learnings.md", content: "x".repeat(40_001) },
        testContext(testDir),
      ),
    )

    //#then size_exceeded and file unchanged
    expect(res.error).toBe("size_exceeded")
    expect(readFileSync(filePath, "utf-8")).toBe(before)
  })
})
