/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

describe("context-mode version pin", () => {
  test("package.json pins context-mode to the 2.1.* range with no caret or tilde", () => {
    //#given the declared dependencies
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf-8")) as {
      dependencies: Record<string, string>
    }
    const pinned = pkg.dependencies["context-mode"]

    //#when read (no action needed)

    //#then it is the 2.1.* star-range on the 2.1 line, not exact and not ^/~
    expect(pinned).toBeDefined()
    expect(pinned).toBe("2.1.*")
    expect(pinned.startsWith("^") || pinned.startsWith("~")).toBe(false)
    expect(pinned).toMatch(/^2\.1\.\*$/)
  })

  test("installed context-mode resolves to a 2.1.x release", () => {
    //#given the installed package anchored at the worktree
    const pkgPath = join(process.cwd(), "node_modules", "context-mode", "package.json")

    //#when the installed version is read
    const installed = existsSync(pkgPath)
      ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown }).version
      : null

    //#then it matches the 2.1.x line
    expect(typeof installed === "string" ? installed : "").toMatch(/^2\.1\.\d+/)
  })
})
