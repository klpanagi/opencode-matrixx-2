/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function createManager(directory: string): BackgroundManager {
  const native = {
    session: {
      create: async () => ({ id: "ses_x" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory } as unknown as MatrixxContext)
}

function seedTask(manager: BackgroundManager, id: string, status: BackgroundTask["status"]): void {
  const task: BackgroundTask = {
    id,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "stop-guard task",
    prompt: "do work",
    agent: "task",
    status,
    startedAt: new Date(),
  }
  manager.tasks.set(id, task)
}

describe("BackgroundManager shutdownWithDeadline", () => {
  test("hung running task → forced within deadline, abandonment recorded", () => {
    //#given a manager with a running task that ignores cancel
    const manager = createManager("/tmp/stop-guard-hung")
    seedTask(manager, "bg_hung", "running")
    manager.store.wallclock.arm("bg_hung", Date.now(), 60_000, () => {})

    //#when bounded teardown runs
    const result = manager.shutdownWithDeadline(500)

    //#then forced with the abandoned task named
    expect(result.forced).toBe(true)
    expect(result.abandoned).toEqual(["bg_hung"])
    //#then Task 3 leftovers cleared: wallclock empty, tasks cleared
    expect(manager.store.wallclock.size()).toBe(0)
    expect(manager.tasks.size).toBe(0)
  })

  test("clean idle manager → graceful, no force", () => {
    //#given a manager with only terminal tasks
    const manager = createManager("/tmp/stop-guard-clean")
    seedTask(manager, "bg_done", "completed")

    //#when bounded teardown runs
    const result = manager.shutdownWithDeadline(500)

    //#then graceful: not forced, nothing abandoned
    expect(result.forced).toBe(false)
    expect(result.abandoned).toEqual([])
  })
})
