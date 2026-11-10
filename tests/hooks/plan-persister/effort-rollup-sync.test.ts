/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseMetadataComment } from "../../../src/features/mission-state/plan-storage"
import { writeMissionState } from "../../../src/features/mission-state/storage"
import type { MissionState } from "../../../src/features/mission-state/types"
import type { TaskObject } from "../../../src/tools/task/types"
import { applyFilteredSync } from "../../../src/hooks/plan-persister/task-sync"

const SESSION = "ses-effort-1"
const BODY = "# Scratch\n\n- [ ] 1. Implement login flow\n- [ ] 2. Add logout button\n"

function setupScratch(body: string = BODY) {
  const dir = mkdtempSync(join(tmpdir(), "plan-effort-"))
  const planDir = join(dir, ".matrixx", "plans")
  mkdirSync(planDir, { recursive: true })
  const planPath = join(planDir, "scratch.md")
  writeFileSync(planPath, body, "utf-8")
  const mission: MissionState = {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [SESSION],
    plan_name: "scratch",
  }
  writeMissionState(dir, mission)
  return { dir, planPath, mission }
}

let seq = 0
function makeTask(dir: string, overrides: Partial<TaskObject> = {}): TaskObject {
  seq += 1
  return {
    id: `T-effort-${seq}`,
    subject: "Implement login flow",
    description: "d",
    status: "completed",
    blocks: [],
    blockedBy: [],
    threadID: SESSION,
    projectRoot: dir,
    generation: 0,
    ...overrides,
  }
}

function writeTaskFile(dir: string, task: TaskObject): void {
  const taskDir = join(dir, ".matrixx", "tasks")
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, `${task.id}.json`), JSON.stringify(task), "utf-8")
}

describe("effort rollup on sync", () => {
  test("sums linked terminal task effort into plan comment", async () => {
    //#given two linked completed tasks carrying metadata.effort
    const { dir, planPath, mission } = setupScratch()
    writeTaskFile(
      dir,
      makeTask(dir, {
        metadata: { effort: { total: 10, tokenUsd: 0.5, computedAt: "2026-01-01T00:00:00.000Z" } },
      }),
    )
    writeTaskFile(
      dir,
      makeTask(dir, {
        id: "T-effort-b",
        subject: "Add logout button",
        metadata: { effort: { total: 20, tokenUsd: 1.5, computedAt: "2026-01-02T00:00:00.000Z" } },
      }),
    )

    //#when the shared sync pipeline runs
    const result = await applyFilteredSync({
      directory: dir,
      mission,
      planPath,
      todos: [
        { content: "Implement login flow", status: "completed" },
        { content: "Add logout button", status: "completed" },
      ],
      actorSessionId: SESSION,
    })

    //#then checkboxes flip and the plan comment carries the summed effort
    expect(result.ok).toBe(true)
    const content = readFileSync(planPath, "utf-8")
    expect(content).toContain("- [x] 1. Implement login flow")
    const meta = parseMetadataComment(content)
    expect(meta?.effortActual?.total).toBe(30)
    expect(meta?.effortActual?.taskCount).toBe(2)
  })

  test("malformed effort leaves checkboxes intact", async () => {
    //#given a linked task with malformed metadata.effort
    const { dir, planPath, mission } = setupScratch()
    writeTaskFile(
      dir,
      makeTask(dir, { metadata: { effort: "not-an-object" } }),
    )

    //#when the shared sync pipeline runs
    const result = await applyFilteredSync({
      directory: dir,
      mission,
      planPath,
      todos: [{ content: "Implement login flow", status: "completed" }],
      actorSessionId: SESSION,
    })

    //#then sync still succeeds and the matching box flips
    expect(result.ok).toBe(true)
    expect(readFileSync(planPath, "utf-8")).toContain("- [x] 1. Implement login flow")
  })

  test("non-terminal task effort is excluded", async () => {
    //#given a pending task carrying effort plus one completed task with effort
    const { dir, planPath, mission } = setupScratch()
    writeTaskFile(
      dir,
      makeTask(dir, {
        id: "T-effort-pending",
        status: "pending",
        metadata: { effort: { total: 100, tokenUsd: 5, computedAt: "2026-01-03T00:00:00.000Z" } },
      }),
    )
    writeTaskFile(
      dir,
      makeTask(dir, {
        id: "T-effort-done",
        metadata: { effort: { total: 7, tokenUsd: 0.7, computedAt: "2026-01-04T00:00:00.000Z" } },
      }),
    )

    //#when the shared sync pipeline runs
    await applyFilteredSync({
      directory: dir,
      mission,
      planPath,
      todos: [{ content: "Implement login flow", status: "completed" }],
      actorSessionId: SESSION,
    })

    //#then only the terminal task contributes to the rollup
    const meta = parseMetadataComment(readFileSync(planPath, "utf-8"))
    expect(meta?.effortActual?.total).toBe(7)
    expect(meta?.effortActual?.taskCount).toBe(1)
  })
})
