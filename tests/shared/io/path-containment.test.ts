import { describe, expect, test } from "bun:test"
import { isWithin } from "../../../src/shared/io/path-containment"

describe("isWithin", () => {
  test("accepts the root itself", () => {
    //#given
    const root = "/a/b"

    //#when
    const result = isWithin(root, "/a/b")

    //#then
    expect(result).toBe(true)
  })

  test("accepts a nested descendant", () => {
    //#given
    const root = "/a/b"

    //#when
    const result = isWithin(root, "/a/b/c/d.txt")

    //#then
    expect(result).toBe(true)
  })

  test("rejects a sibling sharing the root as a string prefix", () => {
    //#given a path whose name merely starts with the root text
    const root = "/a/b"

    //#when
    const result = isWithin(root, "/a/bc")

    //#then the separator boundary is enforced
    expect(result).toBe(false)
  })

  test("rejects traversal that escapes the root", () => {
    //#given a candidate that normalises above the root
    const root = "/a"

    //#when
    const result = isWithin(root, "/a/../etc")

    //#then
    expect(result).toBe(false)
  })

  test("accepts traversal that stays inside the root", () => {
    //#given a candidate that normalises back under the root
    const root = "/a/b"

    //#when
    const result = isWithin(root, "/a/b/c/../d")

    //#then
    expect(result).toBe(true)
  })

  test("tolerates a trailing separator on the root", () => {
    //#given a root written with a trailing slash
    const root = "/a/b/"

    //#when
    const results = [isWithin(root, "/a/b"), isWithin(root, "/a/b/c")]

    //#then
    expect(results).toEqual([true, true])
  })

  test("rejects either argument containing a NUL byte", () => {
    //#given path strings with an embedded NUL
    const nulInRoot = "/a\u0000b"
    const nulInCandidate = "/a/b/c\u0000"

    //#when
    const results = [isWithin(nulInRoot, "/a/b/c"), isWithin("/a/b", nulInCandidate)]

    //#then
    expect(results).toEqual([false, false])
  })
})
