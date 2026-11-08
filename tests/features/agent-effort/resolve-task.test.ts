/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveEffortTaskId } from "../../../src/features/agent-effort/resolve-task"
import { getTaskDir, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import type { Task, TaskStatus } from "../../../src/features/task-storage/types"

const PARENT_SESSION = "ses_parent_resolve"

function makeTask(
  id: string,
  status: TaskStatus,
  threadID: string = PARENT_SESSION,
): Task {
  return {
    id,
    subject: "Resolve effort task",
    description: "Task used to verify effort attribution resolution",
    status,
    blocks: [],
    blockedBy: [],
    generation: 1,
    threadID,
  }
}

function writeTask(directory: string, task: Task): void {
  writeJsonAtomic(join(getTaskDir({}, directory), `${task.id}.json`), task)
}

describe("resolveEffortTaskId", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "matrixx-resolve-effort-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns the explicit id even when matching tasks exist", () => {
    //#given
    writeTask(directory, makeTask("T-only-active", "in_progress"))

    //#when
    const resolved = resolveEffortTaskId({
      directory,
      explicitTaskId: "T-explicit",
      parentSessionID: PARENT_SESSION,
    })

    //#then
    expect(resolved).toBe("T-explicit")
  })

  test("returns the id of the single in_progress task owned by the parent session", () => {
    //#given
    writeTask(directory, makeTask("T-in-progress", "in_progress"))

    //#when
    const resolved = resolveEffortTaskId({ directory, parentSessionID: PARENT_SESSION })

    //#then
    expect(resolved).toBe("T-in-progress")
  })

  test("returns the id of the single pending task owned by the parent session", () => {
    //#given
    writeTask(directory, makeTask("T-pending", "pending"))

    //#when
    const resolved = resolveEffortTaskId({ directory, parentSessionID: PARENT_SESSION })

    //#then
    expect(resolved).toBe("T-pending")
  })

  test("returns undefined when two active tasks make attribution ambiguous", () => {
    //#given
    writeTask(directory, makeTask("T-active-a", "in_progress"))
    writeTask(directory, makeTask("T-active-b", "pending"))

    //#when
    const resolved = resolveEffortTaskId({ directory, parentSessionID: PARENT_SESSION })

    //#then
    expect(resolved).toBeUndefined()
  })

  test("returns undefined when no active tasks exist for the parent session", () => {
    //#given
    writeTask(directory, makeTask("T-completed", "completed"))
    writeTask(directory, makeTask("T-other-session", "in_progress", "ses_other"))

    //#when
    const resolved = resolveEffortTaskId({ directory, parentSessionID: PARENT_SESSION })

    //#then
    expect(resolved).toBeUndefined()
  })

  test("returns undefined without throwing when the directory is missing", () => {
    //#given
    const missing = join(directory, "does-not-exist")

    //#when
    const resolved = resolveEffortTaskId({ directory: missing, parentSessionID: PARENT_SESSION })

    //#then
    expect(resolved).toBeUndefined()
  })

  test("returns undefined when no parent session is provided", () => {
    //#given
    writeTask(directory, makeTask("T-active", "in_progress"))

    //#when
    const resolved = resolveEffortTaskId({ directory })

    //#then
    expect(resolved).toBeUndefined()
  })
})
