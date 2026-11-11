/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

const TEST_DIR = join(process.cwd(), ".test-read-errors-foundation")
const testSchema = z.object({ id: z.string(), value: z.number() })

describe("TypedReadError contract (Task 1 foundation)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("missing file yields typed NotFound error (not raw throw)", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/read-errors")
    const missing = join(TEST_DIR, "nope.json")

    //#when
    const result = mod.readJsonTyped(missing, testSchema)

    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("NotFound")
      expect(result.error).toBeInstanceOf(mod.TypedReadError)
      expect(result.error.path).toBe(missing)
    }
  })

  test("corrupt JSON yields typed Corrupt error", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/read-errors")
    const file = join(TEST_DIR, "corrupt.json")
    writeFileSync(file, "{ invalid json{{{", "utf-8")

    //#when
    const result = mod.readJsonTyped(file, testSchema)

    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("Corrupt")
      expect(result.error).toBeInstanceOf(mod.TypedReadError)
    }
  })

  test("concurrent writers both succeed with no clobber, final file valid JSON", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const file = join(TEST_DIR, "concurrent.json")

    //#when
    await Promise.all([
      (async () => { mod.writeJsonAtomic(file, { id: "a", value: 1 }) })(),
      (async () => { mod.writeJsonAtomic(file, { id: "b", value: 2 }) })(),
    ])

    //#then
    const raw = readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty("id")
    expect(["a", "b"]).toContain(parsed.id)
  })

})
