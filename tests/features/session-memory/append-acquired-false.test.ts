/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  acquireLock,
  appendMemoryEntry,
  getMemoryDir,
  getMemoryFilePath,
} from "../../../src/features/session-memory/storage"

describe("session-memory acquired:false guard (Task 5)", () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `mem-acquired-false-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  test("append on contention performs no write and returns null", () => {
    //#given
    const dir = getMemoryDir(root)
    mkdirSync(dir, { recursive: true })
    const holder = acquireLock(dir)
    expect(holder.acquired).toBe(true)
    const file = getMemoryFilePath(root)
    const existedBefore = existsSync(file)
    const mtimeBefore = existedBefore ? statSync(file).mtimeMs : -1

    //#when
    const entry = appendMemoryEntry(
      {
        id: "mem-1",
        sessionId: "s-1",
        messageId: "m-1",
        scope: "session",
        text: "hello world, not synthetic at all",
        pinned: false,
        removed: false,
      },
      root,
    )

    //#then
    expect(entry).toBeNull()
    if (existedBefore) {
      expect(statSync(file).mtimeMs).toBe(mtimeBefore)
    } else {
      expect(existsSync(file)).toBe(false)
    }
    holder.release()
  })

  test("append on acquired lock applies the write", () => {
    //#given
    const file = getMemoryFilePath(root)

    //#when
    const entry = appendMemoryEntry(
      {
        id: "mem-2",
        sessionId: "s-1",
        messageId: "m-2",
        scope: "session",
        text: "hello world, not synthetic at all",
        pinned: false,
        removed: false,
      },
      root,
    )

    //#then
    expect(entry).not.toBeNull()
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, "utf-8")).toContain("mem-2")
  })
})
