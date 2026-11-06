/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("context-mode version pin", () => {
  test("package.json pins context-mode to exactly 2.1.3 with no range prefix", () => {
    //#given the declared dependencies
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf-8")) as {
      dependencies: Record<string, string>
    }
    const pinned = pkg.dependencies["context-mode"]

    //#when read (no action needed)

    //#then it is the exact locked version, not a range
    expect(pinned).toBeDefined()
    expect(pinned).toBe("2.1.3")
    expect(pinned.startsWith("^") || pinned.startsWith("~")).toBe(false)
  })
})
