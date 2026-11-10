/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveEffortTaskId } from "../../../src/features/agent-effort/resolve-task"
import { getTaskDir, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import type { Task, TaskStatus } from "../../../src/features/task-storage/types"

const PARENT_SESSION = "ses_parent_resolve"
const CHILD_SESSION = "ses_child_resolve"

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

  test("attributes a child run to the parent's active task via session ancestry", () => {
    //#given the parent session owns one active task and the child links up via the registry
    writeTask(directory, makeTask("T-parent-active", "in_progress"))

    //#when only the child session plus a parent lookup is supplied (no parentSessionID)
    const resolved = resolveEffortTaskId({
      directory,
      sessionID: CHILD_SESSION,
      getParentSessionID: (id) => (id === CHILD_SESSION ? PARENT_SESSION : undefined),
    })

    //#then the parent's task receives the effort
    expect(resolved).toBe("T-parent-active")
  })

  test("walks past an empty parent to the grandparent's active task", () => {
    //#given only the grandparent session owns an active task
    writeTask(directory, makeTask("T-grandparent-active", "pending", "ses_grand"))

    //#when the child resolves through a two-hop session chain
    const resolved = resolveEffortTaskId({
      directory,
      sessionID: CHILD_SESSION,
      getParentSessionID: (id) => {
        if (id === CHILD_SESSION) return "ses_mid"
        if (id === "ses_mid") return "ses_grand"
        return undefined
      },
    })

    //#then the grandparent's task receives the effort
    expect(resolved).toBe("T-grandparent-active")
  })

  test("an ambiguous ancestor level returns undefined without guessing further up", () => {
    //#given the parent has two active tasks while the grandparent has exactly one
    writeTask(directory, makeTask("T-ambiguous-a", "in_progress"))
    writeTask(directory, makeTask("T-ambiguous-b", "pending"))
    writeTask(directory, makeTask("T-grandparent-single", "pending", "ses_grand"))

    //#when the child resolves through the chain
    const resolved = resolveEffortTaskId({
      directory,
      sessionID: CHILD_SESSION,
      getParentSessionID: (id) => {
        if (id === CHILD_SESSION) return PARENT_SESSION
        if (id === PARENT_SESSION) return "ses_grand"
        return undefined
      },
    })

    //#then ambiguity is never guessed — no fallback to the grandparent
    expect(resolved).toBeUndefined()
  })

  test("a task beyond the ancestry depth bound is not attributed", () => {
    //#given the only active task sits four session hops above the child
    writeTask(directory, makeTask("T-too-deep", "in_progress", "ses_l4"))

    //#when the child resolves through a four-hop chain (default depth is 3)
    const resolved = resolveEffortTaskId({
      directory,
      sessionID: CHILD_SESSION,
      getParentSessionID: (id) => {
        if (id === CHILD_SESSION) return "ses_l1"
        if (id === "ses_l1") return "ses_l2"
        if (id === "ses_l2") return "ses_l3"
        if (id === "ses_l3") return "ses_l4"
        return undefined
      },
    })

    //#then the walk stops at the bound and attributes nothing
    expect(resolved).toBeUndefined()
  })

  test("a session-parent cycle terminates without throwing", () => {
    //#given no tasks at all and a cyclic parent registry
    const getParentSessionID = (id: string): string | undefined => {
      if (id === CHILD_SESSION) return "ses_a"
      if (id === "ses_a") return "ses_b"
      return CHILD_SESSION
    }

    //#when the child resolves through the cycle (a non-terminating walk would hang here)
    const resolved = resolveEffortTaskId({ directory, sessionID: CHILD_SESSION, getParentSessionID })

    //#then it returned and attributed nothing
    expect(resolved).toBeUndefined()
  })

  test("a throwing parent lookup resolves to no attribution and never throws", () => {
    //#given a parent lookup that always throws
    const getParentSessionID = (): string | undefined => {
      throw new Error("registry unavailable")
    }

    //#when the child resolves
    const resolved = resolveEffortTaskId({ directory, sessionID: CHILD_SESSION, getParentSessionID })

    //#then fail-soft holds
    expect(resolved).toBeUndefined()
  })

  test("explicit id still wins over session ancestry", () => {
    //#given the ancestry walk would find a task
    writeTask(directory, makeTask("T-ancestry-found", "in_progress"))

    //#when an explicit id is supplied alongside the child session
    const resolved = resolveEffortTaskId({
      directory,
      explicitTaskId: "T-explicit",
      sessionID: CHILD_SESSION,
      getParentSessionID: (id) => (id === CHILD_SESSION ? PARENT_SESSION : undefined),
    })

    //#then the explicit id wins
    expect(resolved).toBe("T-explicit")
  })
})
