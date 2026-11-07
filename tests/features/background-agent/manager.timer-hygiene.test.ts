/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function createManager(
  directory: string,
  session: Record<string, unknown> = {},
): BackgroundManager {
  const native = {
    session: {
      create: async () => ({ id: `ses_${Math.random().toString(36).slice(2, 8)}` }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      ...session,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory } as unknown as MatrixxContext)
}

function seedTask(manager: BackgroundManager, overrides: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "hygiene task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
  return task
}

function wallclockSize(manager: BackgroundManager): number {
  return (manager as unknown as { store: { wallclock: { size(): number } } }).store.wallclock.size()
}

function armWallclock(manager: BackgroundManager, taskId: string, ms = 30): void {
  const store = (manager as unknown as { store: { wallclock: { arm(t: string, s: number, m: number, cb: () => void): void } } }).store
  store.wallclock.arm(taskId, Date.now(), ms, () => {})
}

type HandleEventArg = Parameters<BackgroundManager["handleEvent"]>[0]

function idleEvent(sessionID: string): HandleEventArg {
  return { type: "session.idle", data: { sessionID } } as unknown as HandleEventArg
}

function errorEvent(sessionID: string): HandleEventArg {
  return { type: "session.error", data: { sessionID, error: "boom" } } as unknown as HandleEventArg
}

describe("timer hygiene: zero live timers on every exit path", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mgr-hygiene-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("cancel disarms the wallclock timer", async () => {
    //#given
    const manager = createManager(dir)
    const task = seedTask(manager, { id: "bg_cancel1", sessionID: "ses_cancel1" })
    armWallclock(manager, task.id)
    expect(wallclockSize(manager)).toBe(1)

    //#when
    await manager.cancelTask(task.id)

    //#then
    expect(task.status).toBe("cancelled")
    expect(wallclockSize(manager)).toBe(0)
  })

  test("session.idle success path disarms the wallclock timer", () => {
    //#given
    const manager = createManager(dir)
    const task = seedTask(manager, { id: "bg_idle1", sessionID: "ses_idle9" })
    armWallclock(manager, task.id)
    expect(wallclockSize(manager)).toBe(1)

    //#when
    manager.handleEvent(idleEvent("ses_idle9"))

    //#then
    expect(task.status).toBe("completed")
    expect(wallclockSize(manager)).toBe(0)
  })

  test("session.error path disarms the wallclock timer", () => {
    //#given
    const manager = createManager(dir)
    const task = seedTask(manager, { id: "bg_err1", sessionID: "ses_err9" })
    armWallclock(manager, task.id)
    expect(wallclockSize(manager)).toBe(1)

    //#when
    manager.handleEvent(errorEvent("ses_err9"))

    //#then
    expect(task.status).toBe("error")
    expect(wallclockSize(manager)).toBe(0)
  })

  test("execution.succeeded/failed paths disarm the wallclock timer", () => {
    //#given
    const manager = createManager(dir)
    const ok = seedTask(manager, { id: "bg_ok1", sessionID: "ses_ok9" })
    const bad = seedTask(manager, { id: "bg_bad1", sessionID: "ses_bad9" })
    armWallclock(manager, ok.id)
    armWallclock(manager, bad.id)
    expect(wallclockSize(manager)).toBe(2)

    //#when
    manager.handleEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_ok9" } } as unknown as HandleEventArg)
    manager.handleEvent({ type: "session.execution.failed", data: { sessionID: "ses_bad9", error: "x" } } as unknown as HandleEventArg)

    //#then
    expect(ok.status).toBe("completed")
    expect(bad.status).toBe("error")
    expect(wallclockSize(manager)).toBe(0)
  })

  test("shutdown disarms all remaining wallclock timers", () => {
    //#given
    const manager = createManager(dir)
    seedTask(manager, { id: "bg_sd1", sessionID: "ses_sd1" })
    seedTask(manager, { id: "bg_sd2", sessionID: "ses_sd2" })
    armWallclock(manager, "bg_sd1")
    armWallclock(manager, "bg_sd2")
    expect(wallclockSize(manager)).toBe(2)

    //#when
    manager.shutdown()

    //#then
    expect(wallclockSize(manager)).toBe(0)
  })
})
