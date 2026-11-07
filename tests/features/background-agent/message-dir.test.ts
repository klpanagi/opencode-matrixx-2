import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  getMessageDir,
  isValidSessionID,
  resolveSessionDirPath,
} from "../../../src/features/background-agent/message-dir"

const BASE = "/tmp/msg-base"

describe("isValidSessionID", () => {
  test("accepts plain alphanumeric, hyphen, underscore IDs", () => {
    //#given
    const valid = ["task-1", "ses_abc123XYZ", "123e4567-e89b-12d3-a456-426614174000", "a"]

    //#when
    const results = valid.map(isValidSessionID)

    //#then
    expect(results).toEqual([true, true, true, true])
  })

  test("rejects traversal, separators, empty, overlong, null-byte IDs", () => {
    //#given
    const invalid = [
      "../evil",
      "..",
      "a/b",
      "a\\b",
      "/etc/passwd",
      "",
      "a".repeat(65),
      "a\0b",
      " ses",
      "ses_abc!",
    ]

    //#when
    const results = invalid.map(isValidSessionID)

    //#then
    expect(results).toEqual(invalid.map(() => false))
  })
})

describe("resolveSessionDirPath", () => {
  test("resolves valid ID inside base dir", () => {
    //#given
    const id = "ses_abc123"

    //#when
    const result = resolveSessionDirPath(BASE, id)

    //#then
    expect(result).toBe(resolve(BASE, id))
    expect(result.startsWith(resolve(BASE))).toBe(true)
  })

  test("throws on traversal ID ../evil", () => {
    //#given
    const id = "../evil"

    //#when
    const act = () => resolveSessionDirPath(BASE, id)

    //#then
    expect(act).toThrow()
  })

  test("throws on absolute path ID", () => {
    //#given
    const id = "/etc/passwd"

    //#when
    const act = () => resolveSessionDirPath(BASE, id)

    //#then
    expect(act).toThrow()
  })

  test("maps distinct IDs to distinct paths (no collision)", () => {
    //#given
    const first = "task-abc"
    const second = "task-abd"

    //#when
    const firstPath = resolveSessionDirPath(BASE, first)
    const secondPath = resolveSessionDirPath(BASE, second)

    //#then
    expect(firstPath).not.toBe(secondPath)
    expect(firstPath.startsWith(resolve(BASE))).toBe(true)
    expect(secondPath.startsWith(resolve(BASE))).toBe(true)
  })
})

describe("getMessageDir validation gate", () => {
  test("throws on traversal sessionID instead of escaping MESSAGE_STORAGE", () => {
    //#given
    const malicious = "../evil"

    //#when
    const act = () => getMessageDir(malicious)

    //#then
    expect(act).toThrow()
  })

  test("throws on empty sessionID", () => {
    //#given
    const empty = ""

    //#when
    const act = () => getMessageDir(empty)

    //#then
    expect(act).toThrow()
  })
})
