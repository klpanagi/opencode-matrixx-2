/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { writeJsonAtomic } from "../../../src/features/task-storage/storage"

const TEST_DIR = ".test-task-storage-tmp"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

describe("writeJsonAtomic tmp uniqueness (B6)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
  })

  test("uses unique tmp suffix with pid and uuid (no Date.now-only collision)", () => {
    //#given
    const source = readFileSync(join(process.cwd(), "src/features/task-storage/storage.ts"), "utf-8")

    //#when
    const tmpLine = source.split("\n").find((l) => l.includes("tempPath") && l.includes("tmp"))

    //#then
    expect(tmpLine).toBeDefined()
    expect(tmpLine as string).toContain("process.pid")
    expect(tmpLine as string).toContain("randomUUID")
  })

  test("rapid consecutive writes never clobber and leave no tmp files", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "T-rapid.json")

    //#when
    for (let i = 0; i < 20; i++) {
      writeJsonAtomic(filePath, { id: `T-${i}`, n: i })
    }

    //#then
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(parsed).toEqual({ id: "T-19", n: 19 })
    const leftovers = readdirSync(TEST_DIR_ABS).filter((f) => f.includes(".tmp."))
    expect(leftovers).toEqual([])
  })

  test("failed write cleans tmp and rethrows", () => {
    //#given
    const blocker = join(TEST_DIR_ABS, "blocker")
    writeFileSync(blocker, "i am a file, not a dir", "utf-8")
    const filePath = join(blocker, "T-fail.json")

    //#when
    let thrown: unknown = null
    try {
      writeJsonAtomic(filePath, { id: "T-fail" })
    } catch (error) {
      thrown = error
    }

    //#then
    expect(thrown).not.toBeNull()
    const leftovers = readdirSync(TEST_DIR_ABS).filter((f) => f.includes(".tmp."))
    expect(leftovers).toEqual([])
  })
})
