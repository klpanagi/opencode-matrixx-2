import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  appendMemoryEntry,
  getMemoryDir,
  listMemoryEntries,
  readMemoryEntries,
} from "../../../src/features/session-memory/storage"

function makeTmpDir(name: string): string {
  //#given
  const dir = join("/tmp", name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("getMemoryDir", () => {
  test("returns project-scoped .matrixx/memory dir", () => {
    //#given
    const dir = "/tmp/x"
    //#when
    const result = getMemoryDir(dir)
    //#then
    expect(result).toBe("/tmp/x/.matrixx/memory")
  })
})

describe("appendMemoryEntry + readMemoryEntries", () => {
  test("appends JSONL line and reads it back validated", () => {
    //#given
    const dir = makeTmpDir("mem-test-append")
    //#when
    const entry = appendMemoryEntry({ id: "mem-1", sessionId: "s1", messageId: "m1", scope: "session", text: "hello" }, dir)
    //#then
    expect(entry.chars).toBe(5)
    expect(existsSync(join(dir, ".matrixx", "memory", "memory.jsonl"))).toBe(true)
    const all = readMemoryEntries(dir)
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe("mem-1")
  })

  test("each JSONL line parses as valid entry", () => {
    //#given
    const dir = makeTmpDir("mem-test-lines")
    appendMemoryEntry({ id: "a", sessionId: "s", messageId: "m1", scope: "session", text: "one" }, dir)
    appendMemoryEntry({ id: "b", sessionId: "s", messageId: "m2", scope: "session", text: "two" }, dir)
    //#when
    const raw = readFileSync(join(dir, ".matrixx", "memory", "memory.jsonl"), "utf-8")
    //#then
    for (const line of raw.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(readMemoryEntries(dir)).toHaveLength(2)
  })

  test("skips malformed lines", () => {
    //#given
    const dir = makeTmpDir("mem-test-malformed")
    appendMemoryEntry({ id: "a", sessionId: "s", messageId: "m1", scope: "session", text: "ok" }, dir)
    writeFileSync(join(dir, ".matrixx", "memory", "memory.jsonl"), "not-json\n", { flag: "a" })
    //#when
    const all = readMemoryEntries(dir)
    //#then
    expect(all).toHaveLength(1)
  })

  test("list filters by session and excludes removed by default", () => {
    //#given
    const dir = makeTmpDir("mem-test-list")
    appendMemoryEntry({ id: "a", sessionId: "s1", messageId: "m1", scope: "session", text: "one" }, dir)
    appendMemoryEntry({ id: "b", sessionId: "s2", messageId: "m2", scope: "session", text: "two", removed: true }, dir)
    //#when
    const s1 = listMemoryEntries({ sessionId: "s1" }, dir)
    const withRemoved = listMemoryEntries({ includeRemoved: true }, dir)
    //#then
    expect(s1).toHaveLength(1)
    expect(withRemoved).toHaveLength(2)
  })

  test("read returns empty array when no file", () => {
    //#given
    const dir = makeTmpDir("mem-test-empty")
    //#when
    const all = readMemoryEntries(dir)
    //#then
    expect(all).toEqual([])
  })
})
