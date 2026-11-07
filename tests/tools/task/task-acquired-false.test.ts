/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock } from "../../../src/features/task-storage/storage"
import { createTaskCreateTool } from "../../../src/tools/task/task-create"
import { createTaskUpdateTool } from "../../../src/tools/task/task-update"
import type { TaskObject } from "../../../src/tools/task/types"

const TEST_SESSION_ID = "test-session-acquired-false"
const TEST_CONTEXT = {
  sessionID: TEST_SESSION_ID,
  messageID: "test-message-acquired-false",
  agent: "test-agent",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("acquired:false contention guards (Task 5)", () => {
  let testDir: string
  let storagePath: string

  beforeEach(() => {
    testDir = join(tmpdir(), `acquired-false-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    storagePath = join(testDir, "tasks")
    mkdirSync(storagePath, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test("task_create on contention performs no write and returns typed lock error", async () => {
    //#given
    const holder = acquireLock(storagePath)
    expect(holder.acquired).toBe(true)
    const before = readdirSync(storagePath).filter((f) => f.startsWith("T-"))
    const tool = createTaskCreateTool({ morpheus: { tasks: { storage_path: storagePath } } })

    //#when
    const result = JSON.parse(await tool.execute({ subject: "contended create" }, TEST_CONTEXT))

    //#then
    expect(result.error).toBe("task_lock_unavailable")
    const after = readdirSync(storagePath).filter((f) => f.startsWith("T-"))
    expect(after).toEqual(before)
    holder.release()
  })

  test("task_create on acquired lock applies the write", async () => {
    //#given
    const tool = createTaskCreateTool({ morpheus: { tasks: { storage_path: storagePath } } })

    //#when
    const result = JSON.parse(await tool.execute({ subject: "free create" }, TEST_CONTEXT))

    //#then
    expect(result.tasks).toHaveLength(1)
    expect(existsSync(join(storagePath, `${result.tasks[0].id}.json`))).toBe(true)
  })

  test("task_update on contention leaves file mtime/content unchanged with typed lock error", async () => {
    //#given
    const taskId = "T-contended-1"
    const taskPath = join(storagePath, `${taskId}.json`)
    const initial: TaskObject = {
      id: taskId,
      subject: "Original",
      description: "desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    writeFileSync(taskPath, JSON.stringify(initial), "utf-8")
    const mtimeBefore = statSync(taskPath).mtimeMs
    const contentBefore = readFileSync(taskPath, "utf-8")
    const holder = acquireLock(storagePath)
    expect(holder.acquired).toBe(true)
    const tool = createTaskUpdateTool({ morpheus: { tasks: { storage_path: storagePath } } })

    //#when
    const result = JSON.parse(await tool.execute({ id: taskId, subject: "Hacked" }, TEST_CONTEXT))

    //#then
    expect(result.error).toBe("task_lock_unavailable")
    expect(readFileSync(taskPath, "utf-8")).toBe(contentBefore)
    expect(statSync(taskPath).mtimeMs).toBe(mtimeBefore)
    holder.release()
  })

  test("task_update on acquired lock applies the write", async () => {
    //#given
    const taskId = "T-free-1"
    const taskPath = join(storagePath, `${taskId}.json`)
    const initial: TaskObject = {
      id: taskId,
      subject: "Original",
      description: "desc",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    writeFileSync(taskPath, JSON.stringify(initial), "utf-8")
    const tool = createTaskUpdateTool({ morpheus: { tasks: { storage_path: storagePath } } })

    //#when
    const result = JSON.parse(await tool.execute({ id: taskId, subject: "Updated" }, TEST_CONTEXT))

    //#then
    expect(result.task.subject).toBe("Updated")
  })
})
