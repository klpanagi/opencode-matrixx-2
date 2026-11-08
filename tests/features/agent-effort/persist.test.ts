import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { attachEffortToTask } from "../../../src/features/agent-effort/persist"
import type { EffortRecord } from "../../../src/features/agent-effort/types"
import { getTaskDir, readJsonSafe, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import { type Task, TaskSchema } from "../../../src/features/task-storage/types"

function makeRecord(computedAt = "2026-11-08T00:00:00.000Z"): EffortRecord {
  return {
    formulaVersion: 1,
    total: 42,
    tokenUsd: 0.25,
    components: {
      computeUnits: 1,
      actionUnits: 2,
      epistemicUnits: 3,
      coordUnits: 4,
      tokenUsd: 0.25,
      total: 42,
    },
    telemetry: {
      input: 10,
      output: 20,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      steps: 2,
      toolCalls: 1,
      uniqueTools: 1,
      retries: 0,
      durationMs: 1000,
    },
    coverage: "full",
    missing: [],
    computedAt,
  }
}

function makeTask(id: string, generation = 3): Task {
  return {
    id,
    subject: "Test task",
    description: "A task used for persist tests",
    status: "pending",
    blocks: [],
    blockedBy: [],
    generation,
    metadata: { other: "keep-me", count: 7 },
  }
}

function writeTask(directory: string, task: Task): string {
  const path = join(getTaskDir({}, directory), `${task.id}.json`)
  writeJsonAtomic(path, task)
  return path
}

describe("attachEffortToTask", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "matrixx-effort-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("attaches effort into metadata and preserves other metadata keys", async () => {
    //#given
    const task = makeTask("T-happy")
    const path = writeTask(directory, task)
    const record = makeRecord()

    //#when
    const result = await attachEffortToTask(directory, task.id, record)

    //#then
    expect(result).toBe(true)
    const stored = readJsonSafe(path, TaskSchema)
    expect(stored).not.toBeNull()
    const effort = (stored?.metadata?.effort ?? {}) as Record<string, unknown>
    expect(effort.total).toBe(42)
    expect(effort.generation).toBe(task.generation)
    expect(stored?.metadata?.other).toBe("keep-me")
    expect(stored?.metadata?.count).toBe(7)
  })

  test("is idempotent for the same record and generation", async () => {
    //#given
    const task = makeTask("T-idempotent")
    const path = writeTask(directory, task)
    const record = makeRecord()
    const first = await attachEffortToTask(directory, task.id, record)
    const before = readFileSync(path, "utf-8")

    //#when
    const second = await attachEffortToTask(directory, task.id, record)

    //#then
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(readFileSync(path, "utf-8")).toBe(before)
  })

  test("returns false and writes nothing when the task is absent", async () => {
    //#given
    const taskDir = getTaskDir({}, directory)

    //#when
    const result = await attachEffortToTask(directory, "T-missing", makeRecord())

    //#then
    expect(result).toBe(false)
    expect(existsSync(join(taskDir, "T-missing.json"))).toBe(false)
    expect(existsSync(taskDir)).toBe(false)
  })

  test("fails open when the task directory is not usable", async () => {
    //#given
    const blocker = join(directory, "not-a-directory")
    writeFileSync(blocker, "x", "utf-8")

    //#when
    const result = await attachEffortToTask(blocker, "T-any", makeRecord())

    //#then
    expect(result).toBe(false)
  })
})
