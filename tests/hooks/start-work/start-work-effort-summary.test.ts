import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearMissionState } from "../../../src/features/mission-state"
import { createStartWorkHook } from "../../../src/hooks/start-work/start-work-hook"

function effortComment(): string {
  const meta = {
    id: "effort-plan",
    updatedAt: "2026-11-10T00:00:00.000Z",
    sessionId: "ses-test",
    todoTotal: 2,
    todoCompleted: 1,
    effortActual: { total: 120, tokenUsd: 0.5, taskCount: 2, computedAt: "2026-11-10T00:00:00.000Z" },
    estimate: { total: 100, method: "fallback" },
    variance: { delta: 20, pct: 0.2, flag: "ontrack", computedAt: "2026-11-10T00:00:00.000Z" },
  }
  return `<!-- plan-persister: ${JSON.stringify(meta)} -->`
}

describe("start-work effort summary", () => {
  let testDir: string

  function createMockMatrixxContext() {
    return { directory: testDir, client: {} } as Parameters<typeof createStartWorkHook>[0]
  }

  function startWorkOutput() {
    return { parts: [{ type: "text", text: "<session-context>start</session-context>" }] }
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-effort-${randomUUID()}`)
    mkdirSync(join(testDir, ".matrixx/plans"), { recursive: true })
    clearMissionState(testDir)
  })

  afterEach(() => {
    clearMissionState(testDir)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("auto-selected plan with effort data includes a one-line effort summary", async () => {
    //#given a single incomplete plan carrying an effort comment
    const body = ["# Effort Plan", "", "- [ ] Do the thing", "- [x] Done thing", ""].join("\n")
    writeFileSync(join(testDir, ".matrixx/plans/effort-plan.md"), `${body}\n${effortComment()}\n`)
    const hook = createStartWorkHook(createMockMatrixxContext())
    const output = startWorkOutput()

    //#when the start-work command runs
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    //#then the output carries a one-line effort summary
    expect(output.parts[0].text ?? "").toContain("Effort:")
  })

  test("auto-selected plan without effort data stays silent", async () => {
    //#given a single incomplete plan with no effort comment
    writeFileSync(join(testDir, ".matrixx/plans/plain-plan.md"), "# Plain Plan\n\n- [ ] Do the thing\n")
    const hook = createStartWorkHook(createMockMatrixxContext())
    const output = startWorkOutput()

    //#when the start-work command runs
    await hook["chat.message"]({ sessionID: "session-123" }, output)

    //#then no effort summary is emitted
    expect(output.parts[0].text ?? "").not.toContain("Effort:")
  })
})
