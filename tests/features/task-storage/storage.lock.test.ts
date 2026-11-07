/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { acquireLock } from "../../../src/features/task-storage/storage"

const TEST_DIR = ".test-task-storage-lock"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

describe("acquireLock TOCTOU (B4)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
  })

  test("treats lock with missing timestamp as stale and evicts it", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(lockPath, JSON.stringify({ id: "other-owner" }), "utf-8")

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    lock.release()
  })

  test("two concurrent acquires never both succeed", () => {
    //#given
    const first = acquireLock(TEST_DIR_ABS)

    //#when
    const second = acquireLock(TEST_DIR_ABS)

    //#then
    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(false)
    first.release()
  })

  test("does not delete a freshly-refreshed lock (re-validates before unlink)", () => {
    //#given
    const first = acquireLock(TEST_DIR_ABS)
    expect(first.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")
    const original = readFileSync(lockPath, "utf-8")

    //#when
    const second = acquireLock(TEST_DIR_ABS)

    //#then
    expect(second.acquired).toBe(false)
    expect(readFileSync(lockPath, "utf-8")).toBe(original)
    first.release()
  })

  test("foreign release is a noop and preserves the owner lock", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")
    const original = readFileSync(lockPath, "utf-8")

    //#when
    const foreign = acquireLock(TEST_DIR_ABS)
    expect(foreign.acquired).toBe(false)
    foreign.release()

    //#then
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, "utf-8")).toBe(original)
    owner.release()
  })

  test("evicts corrupt lock content as stale", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(lockPath, "not-json{{{", "utf-8")

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    lock.release()
  })
})
