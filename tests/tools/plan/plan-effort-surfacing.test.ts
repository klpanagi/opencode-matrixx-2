/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPlanReadTool } from "../../../src/tools/plan/plan-read"
import { createPlanTasksTool } from "../../../src/tools/plan/plan-tasks"

const TEST_ABORT = new AbortController()

function testContext(testDir: string) {
  return {
    sessionID: "test-session-effort-surface",
    messageID: "test-message-effort-surface",
    agent: "test-agent",
    abort: TEST_ABORT.signal,
    directory: testDir,
  }
}

function writePlan(dir: string, name: string, content: string): void {
  mkdirSync(join(dir, ".matrixx/plans"), { recursive: true })
  Bun.write(join(dir, ".matrixx/plans", name), content)
}

const PLAN_BODY = ["# Effort Plan", "", "## TODOs", "", "- [ ] Do the thing", "- [x] Done thing", ""].join("\n")

function effortComment(): string {
  const meta = {
    id: "effort-plan",
    updatedAt: "2026-11-10T00:00:00.000Z",
    sessionId: "ses-test",
    todoTotal: 2,
    todoCompleted: 1,
    effortActual: { total: 120, tokenUsd: 0.5, taskCount: 2, computedAt: "2026-11-10T00:00:00.000Z" },
    estimate: { total: 100, method: "fallback" },
    variance: { delta: 20, pct: 0.2, computedAt: "2026-11-10T00:00:00.000Z" },
  }
  return `<!-- plan-persister: ${JSON.stringify(meta)} -->`
}

describe("plan effort surfacing", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `plan-effort-surface-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testDir, ".matrixx/plans"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("plan_tasks includes effort fields when the effort comment is present", async () => {
    //#given
    writePlan(testDir, "effort-plan.md", `${PLAN_BODY}\n${effortComment()}\n`)
    const tool = createPlanTasksTool()

    //#when
    const res = JSON.parse(
      await tool.execute({ filePath: ".matrixx/plans/effort-plan.md" }, testContext(testDir)),
    ) as Record<string, unknown>

    //#then
    expect(res).toHaveProperty("effort")
    const effort = res["effort"] as Record<string, unknown>
    expect(effort).toHaveProperty("effortActual")
    expect(effort).toHaveProperty("estimate")
    expect(effort).toHaveProperty("variance")
    expect((effort["effortActual"] as { total: number }).total).toBe(120)
  })

  test("plan_tasks omits effort cleanly when no effort comment exists", async () => {
    //#given
    writePlan(testDir, "plain-plan.md", PLAN_BODY)
    const tool = createPlanTasksTool()

    //#when
    const res = JSON.parse(
      await tool.execute({ filePath: ".matrixx/plans/plain-plan.md" }, testContext(testDir)),
    ) as Record<string, unknown>

    //#then
    expect(res).not.toHaveProperty("effort")
    expect(res).not.toHaveProperty("error")
  })

  test("plan_tasks omits effort on malformed effort keys without error", async () => {
    //#given
    writePlan(
      testDir,
      "broken-plan.md",
      `${PLAN_BODY}\n<!-- plan-persister: {"id":"broken-plan","effortActual":{"total":"lots"}} -->\n`,
    )
    const tool = createPlanTasksTool()

    //#when
    const res = JSON.parse(
      await tool.execute({ filePath: ".matrixx/plans/broken-plan.md" }, testContext(testDir)),
    ) as Record<string, unknown>

    //#then
    expect(res).not.toHaveProperty("error")
    expect(res).toHaveProperty("progress")
  })

  test("plan_read includes effort fields when the effort comment is present", async () => {
    //#given
    writePlan(testDir, "effort-plan.md", `${PLAN_BODY}\n${effortComment()}\n`)
    const tool = createPlanReadTool()

    //#when
    const res = JSON.parse(
      await tool.execute({ filePath: ".matrixx/plans/effort-plan.md" }, testContext(testDir)),
    ) as Record<string, unknown>

    //#then
    expect(res).toHaveProperty("effort")
    expect(res).toHaveProperty("hashline")
  })

  test("plan_read omits effort cleanly when no effort comment exists", async () => {
    //#given
    writePlan(testDir, "plain-plan.md", PLAN_BODY)
    const tool = createPlanReadTool()

    //#when
    const res = JSON.parse(
      await tool.execute({ filePath: ".matrixx/plans/plain-plan.md" }, testContext(testDir)),
    ) as Record<string, unknown>

    //#then
    expect(res).not.toHaveProperty("effort")
    expect(res).toHaveProperty("hashline")
  })
})
