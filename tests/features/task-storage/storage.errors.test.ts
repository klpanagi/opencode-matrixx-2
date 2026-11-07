/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

const TEST_DIR_ABS = join(process.cwd(), ".test-task-storage-errors")
const testSchema = z.object({
  id: z.string(),
  value: z.number(),
})

describe("storage B7 fail-loudly", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) {
      rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    }
    try { spyOnRestore() } catch { /* noop */ }
  })

  test("corrupt JSON returns null for compat but logs path and byte-size loudly", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const logger = await import("../../../src/shared/runtime/logger")
    const calls: Array<{ msg: string; data?: unknown }> = []
    const spy = spyOn(logger, "log").mockImplementation((msg: string, data?: unknown) => {
      calls.push({ msg, data })
    })
    const filePath = join(TEST_DIR_ABS, "corrupt.json")
    const payload = "{ invalid json{{{"
    writeFileSync(filePath, payload, "utf-8")

    //#when
    const result = mod.readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalled()
    const logged = calls.map((c) => c.msg + " " + JSON.stringify(c.data)).join("\n")
    expect(logged).toContain(filePath)
    expect(logged).toContain(String(Buffer.byteLength(payload, "utf-8")))
    expect(logged).not.toContain(payload)
    spy.mockRestore()
  })

  test("schema-mismatch returns null for compat but logs path and byte-size loudly", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const logger = await import("../../../src/shared/runtime/logger")
    const calls: Array<{ msg: string; data?: unknown }> = []
    const spy = spyOn(logger, "log").mockImplementation((msg: string, data?: unknown) => {
      calls.push({ msg, data })
    })
    const filePath = join(TEST_DIR_ABS, "mismatch.json")
    const payload = JSON.stringify({ id: "test", value: "not-a-number" })
    writeFileSync(filePath, payload, "utf-8")

    //#when
    const result = mod.readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalled()
    const logged = calls.map((c) => c.msg + " " + JSON.stringify(c.data)).join("\n")
    expect(logged).toContain(filePath)
    expect(logged).toContain(String(Buffer.byteLength(payload, "utf-8")))
    spy.mockRestore()
  })

  test("typed StorageCorruptError is exported with path and byteSize fields", async () => {
    //#given
    const mod = (await import("../../../src/features/task-storage/storage")) as unknown as Record<string, unknown>

    //#when
    const Ctor = mod["StorageCorruptError"] as new (path: string, byteSize: number, reason: string) => Error & { path: string; byteSize: number; reason: string }

    //#then
    expect(typeof Ctor).toBe("function")
    const err = new Ctor("/tmp/x.json", 12, "parse")
    expect(err).toBeInstanceOf(Error)
    expect(err.path).toBe("/tmp/x.json")
    expect(err.byteSize).toBe(12)
    expect(err.name).toBe("StorageCorruptError")
  })

  test("unreadable path returns null for compat and logs loudly instead of collapsing silently", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const logger = await import("../../../src/shared/runtime/logger")
    const calls: Array<{ msg: string; data?: unknown }> = []
    const spy = spyOn(logger, "log").mockImplementation((msg: string, data?: unknown) => {
      calls.push({ msg, data })
    })
    const filePath = join(TEST_DIR_ABS, "is-a-directory")

    //#when
    mkdirSync(filePath, { recursive: true })
    const result = mod.readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalled()
    const logged = calls.map((c) => c.msg + " " + JSON.stringify(c.data)).join("\n")
    expect(logged).toContain(filePath)
    spy.mockRestore()
  })
})

function spyOnRestore(): void {
  return undefined
}
