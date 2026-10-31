/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../src/plugin/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function createManager(directory: string): BackgroundManager {
  const native = {
    session: {
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory } as unknown as MatrixxContext)
}

function taskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

function seedTask(manager: BackgroundManager, overrides: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "parent-1",
    parentMessageID: "msg-1",
    description: "reconcile task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
  taskMap(manager).set(task.id, task)
  return task
}

describe("BackgroundManager handleEvent normalization (D5: native events only)", () => {
  let dir: string
  let manager: BackgroundManager

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "mgr-reconcile-"))
    manager = createManager(dir)
  })

  afterEach(() => {
    manager.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  test("mismatched sessionID shape still hits after normalize", () => {
    //#given
    const task = seedTask(manager, { id: "t-norm", sessionID: "ses_abc123", status: "running" })

    //#when
    manager.handleEvent({ type: "session.idle", sessionID: "  ses_abc123?x=1  " } as unknown as Parameters<BackgroundManager["handleEvent"]>[0])

    //#then
    expect(task.status).toBe("completed")
    expect(task.completedAt).toBeInstanceOf(Date)
  })

  test("hash suffix is stripped before lookup", () => {
    //#given
    const task = seedTask(manager, { id: "t-hash", sessionID: "ses_hash1", status: "running" })

    //#when
    manager.handleEvent({ type: "session.idle", data: { sessionID: "ses_hash1#frag" } } as unknown as Parameters<BackgroundManager["handleEvent"]>[0])

    //#then
    expect(task.status).toBe("completed")
  })

  test("unknown session is a logged no-op that keeps the map intact", () => {
    //#given
    seedTask(manager, { id: "t-known", sessionID: "ses_known", status: "running" })
    const sizeBefore = taskMap(manager).size

    //#when
    manager.handleEvent({ type: "session.idle", sessionID: "ses_unknown" } as unknown as Parameters<BackgroundManager["handleEvent"]>[0])

    //#then
    expect(taskMap(manager).size).toBe(sizeBefore)
    expect(taskMap(manager).get("t-known")?.status).toBe("running")
  })

  test("non idle/error status is logged and ignored", () => {
    //#given
    const task = seedTask(manager, { id: "t-other", sessionID: "ses_other", status: "running" })

    //#when
    manager.handleEvent({ type: "session.bogus", sessionID: "ses_other" } as unknown as Parameters<BackgroundManager["handleEvent"]>[0])

    //#then
    expect(task.status).toBe("running")
    expect(task.completedAt).toBeUndefined()
  })
  test("session.error marks the task errored with the reported message", () => {
    //#given
    const task = seedTask(manager, { id: "t-err", sessionID: "ses_err", status: "running" })

    //#when
    manager.handleEvent({ type: "session.error", data: { sessionID: "ses_err", error: "boom" } } as unknown as Parameters<BackgroundManager["handleEvent"]>[0])

    //#then
    expect(task.status).toBe("error")
    expect(task.completedAt).toBeInstanceOf(Date)
  })
})
