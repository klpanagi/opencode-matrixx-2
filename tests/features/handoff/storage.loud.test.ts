/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type LogCall = { message: string; data?: unknown }

async function captureLogs<T>(run: () => T | Promise<T>): Promise<{ result: T; calls: LogCall[]; logged: string }> {
  const logger = await import("../../../src/shared/runtime/logger")
  const calls: LogCall[] = []
  const spy = spyOn(logger, "log").mockImplementation((message: string, data?: unknown) => {
    calls.push({ message, data })
  })
  try {
    const result = await run()
    return { result, calls, logged: calls.map((c) => `${c.message} ${JSON.stringify(c.data ?? null)}`).join("\n") }
  } finally {
    spy.mockRestore()
  }
}

describe("T14 loud handoff storage failures", () => {
  const TEST_DIR = join(tmpdir(), `handoff-loud-test-${Date.now()}`)
  const MATRIX_DIR = join(TEST_DIR, ".matrixx")

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(MATRIX_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("readHandoffFile logs the path and reason when the file cannot be read", async () => {
    //#given the handoff path exists but is a directory, so the read fails
    const handoffPath = join(MATRIX_DIR, "handoff.md")
    mkdirSync(handoffPath, { recursive: true })

    const { readHandoffFile } = await import("../../../src/features/handoff/storage")

    //#when
    const { result, logged } = await captureLogs(() => readHandoffFile(TEST_DIR))

    //#then the documented null is returned, but the failure is no longer silent
    expect(result).toBeNull()
    expect(logged).toContain(handoffPath)
    expect(logged).toMatch(/EISDIR|directory|read/i)
  })

  test("archiveHandoffFile logs the path and reason when the rename fails", async () => {
    //#given no handoff file exists to archive
    const { archiveHandoffFile } = await import("../../../src/features/handoff/storage")

    //#when
    const { result, logged } = await captureLogs(() => archiveHandoffFile(TEST_DIR))

    //#then
    expect(result).toBe(false)
    expect(logged).toContain(join(MATRIX_DIR, "handoff.md"))
    expect(logged).toMatch(/ENOENT|no such file/i)
  })

  test("writeHandoffFile logs the path and reason when the atomic write cannot complete", async () => {
    //#given `.matrixx` is a regular file, so the handoff directory cannot be created
    const brokenDir = join(tmpdir(), `handoff-loud-broken-${Date.now()}`)
    if (existsSync(brokenDir)) rmSync(brokenDir, { recursive: true, force: true })
    mkdirSync(brokenDir, { recursive: true })
    writeFileSync(join(brokenDir, ".matrixx"), "not a directory", "utf-8")

    const { writeHandoffFile } = await import("../../../src/features/handoff/storage")

    //#when
    const { result, logged } = await captureLogs(() => writeHandoffFile(brokenDir, "# handoff"))
    rmSync(brokenDir, { recursive: true, force: true })

    //#then
    expect(result).toBe(false)
    expect(logged).toContain(brokenDir)
    expect(logged).toMatch(/EEXIST|ENOTDIR|not a directory|exist/i)
  })

  test("writeHandoffFile still writes the content through the atomic-write primitive", async () => {
    //#given a fresh project directory
    const { writeHandoffFile, readHandoffFile } = await import("../../../src/features/handoff/storage")

    //#when
    const { result } = await captureLogs(() => writeHandoffFile(TEST_DIR, "# plan"))

    //#then
    expect(result).toBe(true)
    expect(readHandoffFile(TEST_DIR)).toBe("# plan")
  })
})
