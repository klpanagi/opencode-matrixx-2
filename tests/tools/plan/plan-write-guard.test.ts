/// <reference types="bun-types" />
import { createRequire } from "node:module"
import { beforeEach, describe, expect, mock, test } from "bun:test"

// Real fs handle: mock.module("node:fs") below replaces the module registry, so
// delegating through a plain `import ... from "node:fs"` binding would recurse.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")

let writeFileCalls = 0
let renameCalls = 0

mock.module("node:fs", () => ({
  ...realFs,
  writeFileSync: (path: string, data: string) => {
    writeFileCalls += 1
    realFs.writeFileSync(path, data)
  },
  renameSync: (from: string, to: string) => {
    renameCalls += 1
    realFs.renameSync(from, to)
  },
}))

import { enforcePlanCap, resetPlanWriteGuardForTesting } from "../../../src/tools/plan/plan-write-guard"

const ORIGINAL = "x".repeat(100)

describe("enforcePlanCap over-cap verdict performs no write", () => {
  beforeEach(() => {
    writeFileCalls = 0
    renameCalls = 0
    resetPlanWriteGuardForTesting()
  })

  test("producing the refusal verdict never calls writeFileSync or renameSync", () => {
    //#given applied content far beyond the cap at a path that was never written
    const applied = "y".repeat(200)

    //#when the guard produces its refusal verdict
    const verdict = enforcePlanCap("/tmp/plan-write-guard-never-written.md", ORIGINAL, applied, 140)

    //#then it refuses
    expect(verdict.kind).toBe("rolled-back")
    //#and the verdict required no rollback write of any kind
    expect(writeFileCalls).toBe(0)
    expect(renameCalls).toBe(0)
  })
})
