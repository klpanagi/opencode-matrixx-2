/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  _resetContextModeEnforcementForTesting,
  deriveContextModeRootFromFile,
  resolveContextModeDisciplineInfo,
} from "../../src/shared/context-mode-enforcement"

describe("context-mode discipline probe against installed 2.1.x layout", () => {
  test("installed package root resolves and reports a 2.1.x version", () => {
    //#given the installed context-mode entry file anchored at the worktree
    _resetContextModeEnforcementForTesting()
    const entry = join(process.cwd(), "node_modules", "context-mode", "opencode", "plugin.js")

    //#when the package root is derived and version read
    const root = existsSync(entry) ? deriveContextModeRootFromFile(entry) : null
    const version =
      root !== null
        ? (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version?: unknown }).version
        : null
    console.log(`discipline-probe evidence: entry=${entry} root=${root} version=${version}`)

    //#then the root is the installed package and the version is on the 2.1.x line
    expect(root).not.toBeNull()
    expect(typeof version === "string" ? version : "").toMatch(/^2\.1\.\d+/)
    _resetContextModeEnforcementForTesting()
  })

  test("discipline probe fail-opens on the 2.1.x layout (no configs/opencode/AGENTS.md)", () => {
    //#given a clean enforcement state with no testing override
    _resetContextModeEnforcementForTesting()

    //#when the discipline info is resolved against the real install
    const info = resolveContextModeDisciplineInfo()
    console.log(`discipline-probe evidence: path=${info.path} version=${info.version}`)

    //#then fail-open: nulls (2.1.x ships no configs/opencode/AGENTS.md), never throws
    expect(info).toEqual({ path: null, version: null })
    _resetContextModeEnforcementForTesting()
  })
})
