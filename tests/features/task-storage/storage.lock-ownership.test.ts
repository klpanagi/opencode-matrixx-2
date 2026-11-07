/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  acquireLock,
  releaseLock,
  refreshLock,
  readLockFile,
} from "../../../src/features/task-storage/storage"

const TEST_DIR = ".test-task-storage-ownership"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

describe("lock ownership (Task 4)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
  })

  test("stamps owner pid and generation on acquire", () => {
    //#given
    // empty dir, no lock

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    const info = readLockFile(TEST_DIR_ABS)
    expect(info).not.toBeNull()
    expect(info?.pid).toBe(process.pid)
    expect(typeof info?.generation).toBe("number")
    expect(typeof info?.ownerId).toBe("string")
    lock.release()
  })

  test("foreign unlock refused with Locked error, lock intact", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")
    const original = readFileSync(lockPath, "utf-8")

    //#when
    const result = releaseLock(TEST_DIR_ABS, "foreign-owner-id")

    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("Locked")
      expect(result.error.name).toBe("TypedReadError")
    }
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, "utf-8")).toBe(original)
    owner.release()
  })

  test("foreign refresh refused with Locked error, timestamp unchanged", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    const before = readLockFile(TEST_DIR_ABS)

    //#when
    const result = refreshLock(TEST_DIR_ABS, "foreign-owner-id")

    //#then
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("Locked")
    expect(readLockFile(TEST_DIR_ABS)?.timestamp).toBe(before?.timestamp)
    owner.release()
  })

  test("owner refresh succeeds and renews timestamp", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    expect(owner.ownerId).toBeDefined()
    const before = readLockFile(TEST_DIR_ABS)

    //#when
    const result = refreshLock(TEST_DIR_ABS, owner.ownerId as string)

    //#then
    expect(result.ok).toBe(true)
    const after = readLockFile(TEST_DIR_ABS)
    expect(after?.ownerId).toBe(before?.ownerId)
    expect((after?.timestamp as number) >= (before?.timestamp as number)).toBe(true)
    owner.release()
  })

  test("owner release succeeds via releaseLock", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")

    //#when
    const result = releaseLock(TEST_DIR_ABS, owner.ownerId as string)

    //#then
    expect(result.ok).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
  })

  test("fresh lock is not taken over by stale path", () => {
    //#given
    const first = acquireLock(TEST_DIR_ABS)
    expect(first.acquired).toBe(true)
    const original = readFileSync(join(TEST_DIR_ABS, ".lock"), "utf-8")

    //#when
    const second = acquireLock(TEST_DIR_ABS)

    //#then
    expect(second.acquired).toBe(false)
    expect(readFileSync(join(TEST_DIR_ABS, ".lock"), "utf-8")).toBe(original)
    first.release()
  })

  test("stale takeover only after 30s expiry with generation bump", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(
      lockPath,
      JSON.stringify({ id: "old-owner", ownerId: "old-owner", pid: 1, generation: 2, timestamp: Date.now() - 31000 }),
      "utf-8",
    )

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    const info = readLockFile(TEST_DIR_ABS)
    expect(info?.generation).toBe(3)
    expect(info?.ownerId).not.toBe("old-owner")
    lock.release()
  })

  test("near-stale lock just under 30s is not taken over", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(
      lockPath,
      JSON.stringify({ id: "old-owner", ownerId: "old-owner", pid: 1, generation: 0, timestamp: Date.now() - 29000 }),
      "utf-8",
    )

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(false)
    expect(readLockFile(TEST_DIR_ABS)?.ownerId).toBe("old-owner")
  })
})
