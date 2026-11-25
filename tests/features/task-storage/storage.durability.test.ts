/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import {
  _resetCorruptReadStatsForTesting,
  getCorruptReadStats,
  readJsonSafe,
  readJsonStrict,
  StorageCorruptError,
  writeJsonAtomic,
} from "../../../src/features/task-storage/storage"

const TEST_DIR = ".test-task-storage-durability"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

const testSchema = z.object({
  id: z.string(),
  value: z.number(),
})

describe("task-storage durability (B3)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    _resetCorruptReadStatsForTesting()
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    _resetCorruptReadStatsForTesting()
  })

  test("writeJsonAtomic calls fsyncSync on the tmp descriptor before renameSync", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "T-fsync.json")
    const order: string[] = []
    const realFsyncSync = fs.fsyncSync
    const realRenameSync = fs.renameSync
    const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation((fd: number) => {
      order.push("fsync")
      realFsyncSync(fd)
    })
    const renameSpy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      order.push("rename")
      realRenameSync(from, to)
    })

    try {
      //#when
      writeJsonAtomic(filePath, { id: "T-fsync", value: 1 })
    } finally {
      fsyncSpy.mockRestore()
      renameSpy.mockRestore()
    }

    //#then
    const firstFsync = order.indexOf("fsync")
    const renameAt = order.indexOf("rename")
    expect(firstFsync).toBeGreaterThanOrEqual(0)
    expect(renameAt).toBeGreaterThan(firstFsync)
    expect(order[0]).toBe("fsync")
    expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({ id: "T-fsync", value: 1 })
    expect(fs.readdirSync(TEST_DIR_ABS).filter((name) => name.includes(".tmp."))).toEqual([])
  })

  test("a failed fsync surfaces as a throw and removes the tmp file", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "T-fsync-fail.json")
    const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Object.assign(new Error("simulated EIO"), { code: "EIO" })
    })

    //#when
    let thrown: unknown = null
    try {
      writeJsonAtomic(filePath, { id: "T-fsync-fail", value: 2 })
    } catch (error) {
      thrown = error
    } finally {
      fsyncSpy.mockRestore()
    }

    //#then
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("simulated EIO")
    expect(existsSync(filePath)).toBe(false)
    expect(fs.readdirSync(TEST_DIR_ABS).filter((name) => name.includes(".tmp."))).toEqual([])
  })
})

describe("task-storage corrupt-read accounting (M1)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    _resetCorruptReadStatsForTesting()
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    _resetCorruptReadStatsForTesting()
  })

  test("a truncated task file increments the counter while still returning null", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "T-truncated.json")
    writeFileSync(filePath, '{"id":"T-truncated","value":', "utf-8")

    //#when
    const result = readJsonSafe(filePath, testSchema)

    //#then
    expect(result).toBeNull()
    const stats = getCorruptReadStats()
    expect(stats.count).toBe(1)
    expect(stats.paths.some((p) => p.endsWith("T-truncated.json"))).toBe(true)
  })

  test("all three readJsonSafe failure branches are counted", () => {
    //#given
    const parsePath = join(TEST_DIR_ABS, "T-parse.json")
    const schemaPath = join(TEST_DIR_ABS, "T-schema.json")
    const unreadablePath = join(TEST_DIR_ABS, "T-unreadable.json")
    writeFileSync(parsePath, "{ not json", "utf-8")
    writeFileSync(schemaPath, JSON.stringify({ id: "T-schema", value: "not-a-number" }), "utf-8")
    mkdirSync(unreadablePath)

    //#when
    expect(readJsonSafe(parsePath, testSchema)).toBeNull()
    expect(readJsonSafe(schemaPath, testSchema)).toBeNull()
    expect(readJsonSafe(unreadablePath, testSchema)).toBeNull()

    //#then
    const stats = getCorruptReadStats()
    expect(stats.count).toBe(3)
    expect(stats.paths).toContain(parsePath)
    expect(stats.paths).toContain(schemaPath)
    expect(stats.paths).toContain(unreadablePath)
  })

  test("a missing file is not counted as corrupt", () => {
    //#given
    const missingPath = join(TEST_DIR_ABS, "T-missing.json")

    //#when
    const result = readJsonSafe(missingPath, testSchema)

    //#then
    expect(result).toBeNull()
    expect(getCorruptReadStats().count).toBe(0)
  })

  test("remembered paths are capped at 20", () => {
    //#given
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(TEST_DIR_ABS, `T-corrupt-${i}.json`), "{", "utf-8")
    }

    //#when
    for (let i = 0; i < 25; i++) {
      readJsonSafe(join(TEST_DIR_ABS, `T-corrupt-${i}.json`), testSchema)
    }

    //#then
    const stats = getCorruptReadStats()
    expect(stats.count).toBe(25)
    expect(stats.paths.length).toBe(20)
  })

  test("one aggregated warning is logged per synchronous read pass", async () => {
    //#given
    const logger = await import("../../../src/shared/runtime/logger")
    const records: Array<{ message: string; data?: unknown }> = []
    const loggerSpy = spyOn(logger, "log").mockImplementation((message: string, data?: unknown) => {
      records.push({ message, data })
    })
    writeFileSync(join(TEST_DIR_ABS, "T-aggregate-1.json"), "{", "utf-8")
    writeFileSync(join(TEST_DIR_ABS, "T-aggregate-2.json"), "{", "utf-8")

    try {
      //#when
      readJsonSafe(join(TEST_DIR_ABS, "T-aggregate-1.json"), testSchema)
      readJsonSafe(join(TEST_DIR_ABS, "T-aggregate-2.json"), testSchema)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      //#then
      const aggregate = records.filter((record) => record.message.includes("corrupt task reads"))
      expect(aggregate.length).toBe(1)
      expect(JSON.stringify(aggregate[0].data)).toContain("2")
    } finally {
      loggerSpy.mockRestore()
    }
  })
})

describe("readJsonStrict on a truncated file (B3)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
    _resetCorruptReadStatsForTesting()
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    _resetCorruptReadStatsForTesting()
  })

  test("still throws StorageCorruptError with a non-zero byte size", () => {
    //#given
    const filePath = join(TEST_DIR_ABS, "T-half-written.json")
    const payload = '{"id":"T-half-written","value":'
    writeFileSync(filePath, payload, "utf-8")

    //#when
    let thrown: unknown = null
    try {
      readJsonStrict(filePath, testSchema)
    } catch (error) {
      thrown = error
    }

    //#then
    expect(thrown).toBeInstanceOf(StorageCorruptError)
    const corrupt = thrown as StorageCorruptError
    expect(corrupt.path).toBe(filePath)
    expect(corrupt.byteSize).toBeGreaterThan(0)
    expect(corrupt.byteSize).toBe(Buffer.byteLength(payload, "utf-8"))
    expect(corrupt.reason.length).toBeGreaterThan(0)
  })
})
