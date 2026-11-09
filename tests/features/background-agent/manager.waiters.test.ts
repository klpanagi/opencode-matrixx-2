/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BackgroundManager } from "../../../src/features/background-agent/manager/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { NativePluginContext } from "../../../src/shared/session/session-context-source"

function buildCtx(dir: string): NativePluginContext {
  const native = {
    session: {
      create: async () => ({ id: "ses_x" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return { directory: dir, ...native } as unknown as NativePluginContext
}

function seedTask(
  manager: BackgroundManager,
  overrides: Partial<BackgroundTask> & { id: string },
): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "waiter task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
  return task
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe("waiter lifecycle", () => {
  let dir: string
  let manager: BackgroundManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mgr-waiters-"))
    manager = new BackgroundManager(buildCtx(dir))
  })

  afterEach(() => {
    manager.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  test("sibling cancel wakes the wait instead of rejecting it", async () => {
    //#given
    const first = seedTask(manager, { id: "bg_w1", sessionID: "ses_w1", status: "running" })
    const second = seedTask(manager, { id: "bg_w2", sessionID: "ses_w2", status: "running" })
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 5)
    let rejected = false
    pending.catch(() => {
      rejected = true
    })

    //#when
    await manager.cancelTask(first.id)
    await flushMicrotasks()
    second.status = "completed"
    const result = await pending

    //#then
    expect(rejected).toBe(false)
    expect(result.completed.map((row) => row.id).sort()).toEqual(["bg_w1", "bg_w2"])
    expect(result.completed.find((row) => row.id === "bg_w1")?.status).toBe("cancelled")
    expect(result.completed.find((row) => row.id === "bg_w2")?.status).toBe("completed")
    expect(result.timedOut).toEqual([])
    expect(manager.waiterCount()).toBe(0)
  })

  test("cancel of an unrelated parent leaves the waiter untouched", async () => {
    //#given
    seedTask(manager, {
      id: "bg_parent_a",
      sessionID: "ses_a",
      parentSessionID: "ses_parent_a",
      status: "running",
    })
    const unrelated = seedTask(manager, {
      id: "bg_parent_b",
      sessionID: "ses_b",
      parentSessionID: "ses_parent_b",
      status: "running",
    })
    const pending = manager.waitForAllDescendants("ses_parent_a", 60000, 5)
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    const before = manager.waiterCount()

    //#when
    await manager.cancelTask(unrelated.id)
    await flushMicrotasks()

    //#then
    expect(settled).toBe(false)
    expect(manager.waiterCount()).toBe(before)
    expect(manager.waiterCount()).toBeGreaterThan(0)

    // cleanup: let the still-pending wait finish cleanly
    const waiterTask = (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.get(
      "bg_parent_a",
    )
    if (waiterTask) waiterTask.status = "completed"
    const result = await pending
    expect(result.completed.map((row) => row.id)).toContain("bg_parent_a")
  })

  test("aborting the signal rejects the waiter promptly and clears it", async () => {
    //#given
    seedTask(manager, { id: "bg_abort", sessionID: "ses_abort", status: "running" })
    const controller = new AbortController()
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 5, {
      signal: controller.signal,
    })
    pending.catch(() => {})
    const start = Date.now()

    //#when
    controller.abort(new Error("stop waiting"))

    //#then
    await expect(pending).rejects.toThrow("stop waiting")
    expect(Date.now() - start).toBeLessThan(1000)
    expect(manager.waiterCount()).toBe(0)
  })

  test("timeout settles with timedOut rows and no waiter leak", async () => {
    //#given
    seedTask(manager, { id: "bg_timeout", sessionID: "ses_timeout", status: "running" })

    //#when
    const result = await manager.waitForAllDescendants("ses_parent", 20, 5)

    //#then
    expect(result.completed).toEqual([])
    expect(result.timedOut.map((row) => row.id)).toEqual(["bg_timeout"])
    expect(manager.waiterCount()).toBe(0)
  })

  test("sibling cancel no longer rejects the waiter (PR-0 reproduction)", async () => {
    //#given
    // On ab719839f a sibling cancel rejected every waiter of that parent,
    // even though another task under the same parent was still running.
    const first = seedTask(manager, { id: "bg_repro_1", sessionID: "ses_repro_1", status: "running" })
    const second = seedTask(manager, { id: "bg_repro_2", sessionID: "ses_repro_2", status: "running" })
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 5)
    pending.catch(() => {})

    //#when
    await manager.cancelTask(first.id)
    const outcome = await Promise.race([
      pending.then(
        () => "settled" as const,
        () => "rejected" as const,
      ),
      Bun.sleep(50).then(() => "pending" as const),
    ])

    //#then
    expect(outcome).toBe("pending")
    expect(manager.waiterCount()).toBe(1)

    // cleanup: signal the remaining work settling so the wait can return
    second.status = "completed"
    const result = await pending
    expect(result.completed.map((row) => row.id).sort()).toEqual(["bg_repro_1", "bg_repro_2"])
    expect(manager.waiterCount()).toBe(0)
  })
})
