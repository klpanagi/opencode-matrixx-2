/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { writeMissionState } from "../../../src/features/mission-state/storage"
import type { MissionState } from "../../../src/features/mission-state/types"
import { acquireLock } from "../../../src/features/task-storage/storage"
import {
  applyFilteredSync,
  planLockDir,
  withPlanLock,
} from "../../../src/hooks/plan-persister/task-sync"
import { createTaskUpdateTool } from "../../../src/tools/task/task-update"
import type { TaskObject } from "../../../src/tools/task/types"

const SESSION = "ses-plan-race-1"
const LETTERS = "abcdefghijklmnopqrst"
const BOX_COUNT = 20

function distinctBoxBody(count: number): string {
  const lines = ["# Race Plan", ""]
  for (let i = 1; i <= count; i += 1) {
    const letter = LETTERS[i - 1]
    lines.push(`- [ ] ${i}. sector${letter} band${letter} drill`)
  }
  return `${lines.join("\n")}\n`
}

function todoFor(index: number): { content: string; status: string } {
  const letter = LETTERS[index - 1]
  return { content: `sector${letter} band${letter}`, status: "completed" }
}

function checkedBoxes(content: string): number {
  return (content.match(/^- \[x\]/gm) ?? []).length
}

const createdDirs: string[] = []

function setup(count: number = BOX_COUNT): { dir: string; planPath: string; mission: MissionState } {
  const dir = mkdtempSync(join(tmpdir(), "plan-race-"))
  createdDirs.push(dir)
  const planDir = join(dir, ".matrixx", "plans")
  mkdirSync(planDir, { recursive: true })
  const planPath = join(planDir, "race.md")
  writeFileSync(planPath, distinctBoxBody(count), "utf-8")
  const mission: MissionState = {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [SESSION],
    plan_name: "race",
  }
  writeMissionState(dir, mission)
  return { dir, planPath, mission }
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("plan sync concurrency", () => {
  test("20 concurrent distinct flips all land (no lost update)", async () => {
    //#given a plan with 20 unchecked boxes and one distinct todo per box
    const { dir, planPath, mission } = setup()
    const calls = Array.from({ length: BOX_COUNT }, (_unused, index) => {
      const todo = todoFor(index + 1)
      //#when every sync runs concurrently, each flipping a different box
      return applyFilteredSync({
        directory: dir,
        mission,
        planPath,
        todos: [todo],
        actorSessionId: SESSION,
      })
    })
    await Promise.all(calls)

    //#then no flip is lost: all 20 boxes are checked
    expect(checkedBoxes(readFileSync(planPath, "utf-8"))).toBe(BOX_COUNT)
  })
})

describe("withPlanLock", () => {
  test("lock directory is the sha256 of the resolved plan path under .matrixx/.locks", () => {
    //#given a plan file inside .matrixx/plans
    const { dir, planPath } = setup(1)
    //#when deriving its lock directory
    const lockDir = planLockDir(planPath)
    const digest = createHash("sha256").update(resolve(planPath)).digest("hex")
    //#then it is keyed under .matrixx/.locks by the full digest
    expect(lockDir).toBe(join(dir, ".matrixx", ".locks", digest))
  })

  test("same-path bodies run strictly FIFO in-process", async () => {
    //#given five bodies contending for one plan
    const { planPath } = setup(1)
    let active = 0
    let maxActive = 0
    //#when they all run through withPlanLock at once
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withPlanLock(planPath, async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await Bun.sleep(3)
          active -= 1
        }),
      ),
    )
    //#then they never overlap
    expect(maxActive).toBe(1)
  })

  test("the cross-process lock file exists only while the body runs", async () => {
    //#given a plan and its derived lock directory
    const { planPath } = setup(1)
    const lockFile = join(planLockDir(planPath), ".lock")
    let heldDuringBody = false
    //#when a locked body observes the filesystem
    await withPlanLock(planPath, () => {
      heldDuringBody = existsSync(lockFile)
    })
    //#then the lock is held for the body and released afterwards
    expect(heldDuringBody).toBe(true)
    expect(existsSync(lockFile)).toBe(false)
  })

  test("a throwing body does not poison the in-process chain", async () => {
    //#given a plan whose first body throws
    const { planPath } = setup(1)
    await expect(
      withPlanLock(planPath, () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    //#when a later body acquires the same plan
    let ran = false
    await withPlanLock(planPath, () => {
      ran = true
    })
    //#then the chain still drains and the later body runs
    expect(ran).toBe(true)
  })
})

describe("task_update holds the task lock across the plan sync", () => {
  test("task lock stays held while the plan sync waits on its lock", async () => {
    //#given a linked task, an active plan, and a foreign lock on the plan
    const { dir, planPath } = setup(1)
    const taskDir = join(dir, ".matrixx", "tasks")
    mkdirSync(taskDir, { recursive: true })
    const task: TaskObject = {
      id: "T-race-lock-1",
      subject: "sectora banda",
      description: "race",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: SESSION,
      projectRoot: dir,
    }
    writeFileSync(join(taskDir, `${task.id}.json`), JSON.stringify(task), "utf-8")
    const foreignLockFile = join(planLockDir(planPath), ".lock")
    mkdirSync(planLockDir(planPath), { recursive: true })
    writeFileSync(
      foreignLockFile,
      JSON.stringify({
        id: "foreign",
        ownerId: "foreign",
        pid: process.pid,
        generation: 0,
        timestamp: Date.now(),
      }),
      "utf-8",
    )
    const tool = createTaskUpdateTool({})
    const context = {
      sessionID: SESSION,
      messageID: "msg-race-lock",
      agent: "test-agent",
      directory: dir,
      worktree: dir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    //#when the update runs and blocks in the plan-sync lock attempt
    const updatePromise = tool.execute({ id: task.id, status: "completed" }, context)
    const taskLockFile = join(taskDir, ".lock")
    for (let i = 0; i < 500 && !existsSync(taskLockFile); i += 1) {
      await Bun.sleep(2)
    }
    expect(existsSync(taskLockFile)).toBe(true)
    const probe = acquireLock(taskDir)
    const contended = !probe.acquired
    if (probe.acquired) probe.release()
    const foreignStillHeld = existsSync(foreignLockFile)

    //#then the task lock is still held mid-sync and the plan is untouched
    expect(contended).toBe(true)
    expect(foreignStillHeld).toBe(true)
    const result = JSON.parse(await updatePromise)
    expect(result.task.status).toBe("completed")
    expect(checkedBoxes(readFileSync(planPath, "utf-8"))).toBe(0)
    unlinkSync(foreignLockFile)
  })
})
