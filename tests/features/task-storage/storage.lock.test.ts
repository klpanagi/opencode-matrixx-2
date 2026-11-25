/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock } from "../../../src/features/task-storage/storage"
import { createTaskUpdateTool } from "../../../src/tools/task/task-update"

const TEST_DIR = ".test-task-storage-lock"
const TEST_DIR_ABS = join(process.cwd(), TEST_DIR)

const RECLAIM_WORKER_SOURCE = (storageModulePath: string): string => `
import { acquireLock } from ${JSON.stringify(storageModulePath)}
const [dirPath, resultPath, startAtRaw] = process.argv.slice(2)
const startAt = Number(startAtRaw)
while (Date.now() < startAt) {}
const lock = acquireLock(dirPath)
await Bun.write(resultPath, lock.acquired ? "acquired" : "lost")
await Bun.sleep(400)
`

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(filePath)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${filePath}`)
    await Bun.sleep(10)
  }
}

async function runReclaimRound(workerPath: string, round: number): Promise<string[]> {
  const lockPath = join(TEST_DIR_ABS, ".lock")
  writeFileSync(
    lockPath,
    JSON.stringify({
      id: "stale-owner",
      ownerId: "stale-owner",
      pid: 999999,
      generation: 4,
      timestamp: Date.now() - 31000,
    }),
    "utf-8",
  )

  const resultPaths = [
    join(TEST_DIR_ABS, `reclaim-result-a-${round}`),
    join(TEST_DIR_ABS, `reclaim-result-b-${round}`),
  ]
  const startAt = Date.now() + 300
  const workers = resultPaths.map((resultPath) =>
    Bun.spawn([process.execPath, workerPath, TEST_DIR_ABS, resultPath, String(startAt)], {
      stdout: "ignore",
      stderr: "inherit",
    }),
  )

  for (const resultPath of resultPaths) {
    await waitForFile(resultPath, 5000)
  }
  const outcomes = resultPaths.map((resultPath) => readFileSync(resultPath, "utf-8").trim())
  await Promise.all(workers.map((worker) => worker.exited))
  rmSync(lockPath, { force: true })
  return outcomes
}

describe("acquireLock TOCTOU (B4)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
  })

  test("treats lock with missing timestamp as stale and evicts it", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(lockPath, JSON.stringify({ id: "other-owner" }), "utf-8")

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    lock.release()
  })

  test("two concurrent acquires never both succeed", () => {
    //#given
    const first = acquireLock(TEST_DIR_ABS)

    //#when
    const second = acquireLock(TEST_DIR_ABS)

    //#then
    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(false)
    first.release()
  })

  test("two concurrent processes reclaiming one stale lock yield exactly one holder", async () => {
    //#given
    const workerPath = join(TEST_DIR_ABS, "reclaim-worker.ts")
    const storageModulePath = join(process.cwd(), "src/features/task-storage/storage.ts")
    writeFileSync(workerPath, RECLAIM_WORKER_SOURCE(storageModulePath), "utf-8")

    //#when
    const rounds = [await runReclaimRound(workerPath, 1), await runReclaimRound(workerPath, 2)]

    //#then
    for (const outcomes of rounds) {
      expect(outcomes.filter((outcome) => outcome === "acquired")).toHaveLength(1)
    }
  })

  test("treats a lock with a dead pid as stale immediately, even when it is 1 ms old", async () => {
    //#given
    const dead = Bun.spawn(["true"])
    const deadPid = dead.pid
    await dead.exited
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(
      lockPath,
      JSON.stringify({
        id: "dead-owner",
        ownerId: "dead-owner",
        pid: deadPid,
        generation: 1,
        timestamp: Date.now() - 1,
      }),
      "utf-8",
    )

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    lock.release()
  })

  test("does not delete a freshly-refreshed lock (re-validates before unlink)", () => {
    //#given
    const first = acquireLock(TEST_DIR_ABS)
    expect(first.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")
    const original = readFileSync(lockPath, "utf-8")

    //#when
    const second = acquireLock(TEST_DIR_ABS)

    //#then
    expect(second.acquired).toBe(false)
    expect(readFileSync(lockPath, "utf-8")).toBe(original)
    first.release()
  })

  test("foreign release is a noop and preserves the owner lock", () => {
    //#given
    const owner = acquireLock(TEST_DIR_ABS)
    expect(owner.acquired).toBe(true)
    const lockPath = join(TEST_DIR_ABS, ".lock")
    const original = readFileSync(lockPath, "utf-8")

    //#when
    const foreign = acquireLock(TEST_DIR_ABS)
    expect(foreign.acquired).toBe(false)
    foreign.release()

    //#then
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, "utf-8")).toBe(original)
    owner.release()
  })

  test("evicts corrupt lock content as stale", () => {
    //#given
    const lockPath = join(TEST_DIR_ABS, ".lock")
    writeFileSync(lockPath, "not-json{{{", "utf-8")

    //#when
    const lock = acquireLock(TEST_DIR_ABS)

    //#then
    expect(lock.acquired).toBe(true)
    lock.release()
  })
})

describe("lock exhaustion is a typed tool error (C5)", () => {
  let taskDir: string

  beforeEach(() => {
    taskDir = join(tmpdir(), `t16-lock-exhaustion-${randomUUID()}`)
    mkdirSync(taskDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(taskDir)) rmSync(taskDir, { recursive: true, force: true })
  })

  test("task_update throws TaskLockUnavailableError instead of returning a data string", async () => {
    //#given
    const lockPath = join(taskDir, ".lock")
    writeFileSync(
      lockPath,
      JSON.stringify({
        id: "foreign-holder",
        ownerId: "foreign-holder",
        pid: process.pid,
        generation: 1,
        timestamp: Date.now(),
      }),
      "utf-8",
    )
    const tool = createTaskUpdateTool({ morpheus: { tasks: { storage_path: taskDir } } })
    const context = {
      sessionID: "t16-lock-session",
      messageID: "t16-lock-message",
      agent: "mouse",
      directory: process.cwd(),
      worktree: process.cwd(),
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    //#when
    const outcome = await tool
      .execute({ id: "T-test-123", subject: "contended update" }, context)
      .catch((error: unknown) => error)

    //#then
    const { TaskLockUnavailableError } = await import("../../../src/features/task-storage/storage")
    expect(outcome).toBeInstanceOf(TaskLockUnavailableError)
    expect((outcome as Error).name).toBe("TaskLockUnavailableError")
    expect((outcome as Error).message).toContain(lockPath)
  })
})
