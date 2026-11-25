/// <reference types="bun-types" />
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Real fs handle: mock.module("node:fs") below replaces the module registry, so
// delegating through a plain `import ... from "node:fs"` binding would recurse.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")
const realRenameSync = realFs.renameSync as (from: string, to: string) => void

let renameCalls = 0
let failAt: number | null = null

mock.module("node:fs", () => ({
  ...realFs,
  renameSync: (from: string, to: string) => {
    renameCalls += 1
    if (failAt !== null && renameCalls === failAt) {
      throw new Error("forced plan write failure")
    }
    realRenameSync(from, to)
  },
}))

import { createPlanUpdateTool } from "../../../src/tools/plan/plan-update"
import { makePlanDir, planFile, removePlanDir, testContext, writePlan } from "./plan-update-section-fixtures"

const PLAN_REL = ".matrixx/plans/atomic-plan.md"
const PLAN_BODY = ["# Atomic Plan", "", "## TODOs", "- [ ] 1. first task", ""].join("\n")

describe("plan_update atomic persistence failure", () => {
  let testDir: string
  let ctx: ReturnType<typeof testContext>

  beforeEach(() => {
    testDir = makePlanDir()
    ctx = testContext(testDir)
    renameCalls = 0
    failAt = null
  })

  afterEach(() => {
    removePlanDir(testDir)
  })

  test("a forced rename failure returns a tool error and restores the plan", async () => {
    //#given a front-matter-less plan whose update persists in two writes
    writePlan(testDir, "atomic-plan.md", PLAN_BODY)
    const path = planFile(testDir, "atomic-plan.md")
    failAt = 2

    //#when the post-edit front-matter write is forced to fail
    const raw = await createPlanUpdateTool().execute(
      { filePath: PLAN_REL, edits: [{ op: "append", section: "todos", lines: ["- [ ] 2. second task"] }] },
      ctx,
    )
    const res = JSON.parse(raw)

    //#then the failure is surfaced instead of being reported as success
    expect(res.success).toBeUndefined()
    expect(res.error).toBe("write_failed")
    expect(res.reason).toContain("forced plan write failure")
    //#and the undecided write was rolled back to the original bytes
    expect(realFs.readFileSync(path, "utf-8")).toBe(PLAN_BODY)
    expect(renameCalls).toBeGreaterThanOrEqual(2)
  })
})
