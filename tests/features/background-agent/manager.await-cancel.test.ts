/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BackgroundManager } from "../../../src/features/background-agent/manager/manager"
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

describe("Task2 await-cancel", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "await-cancel-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("cancel settles pending await promptly with no waiter leak", async () => {
    //#given
    const manager = new BackgroundManager(buildCtx(dir))
    await manager.trackTask({
      taskId: "bg_stuck_1",
      sessionID: "ses_stuck_1",
      parentSessionID: "ses_parent",
      description: "stuck task",
    })
    const controller = new AbortController()
    const before = manager.waiterCount()

    //#when
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 50, {
      signal: controller.signal,
    })
    controller.abort(new Error("cancelled"))
    const start = Date.now()
    await expect(pending).rejects.toThrow()
    const elapsed = Date.now() - start

    //#then
    expect(elapsed).toBeLessThan(1000)
    expect(manager.waiterCount()).toBe(before)
  })

  test("double cancel is idempotent with no unhandled rejection", async () => {
    //#given
    const manager = new BackgroundManager(buildCtx(dir))
    await manager.trackTask({
      taskId: "bg_stuck_2",
      sessionID: "ses_stuck_2",
      parentSessionID: "ses_parent",
      description: "stuck task",
    })
    const controller = new AbortController()
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 50, {
      signal: controller.signal,
    })
    pending.catch(() => {})

    //#when
    controller.abort(new Error("cancelled"))
    controller.abort(new Error("cancelled"))
    await expect(pending).rejects.toThrow()

    //#then
    expect(manager.waiterCount()).toBe(0)
    const again = await manager.cancelTask("bg_stuck_2")
    expect([true, false]).toContain(again)
  })

  test("shutdown settles pending await", async () => {
    //#given
    const manager = new BackgroundManager(buildCtx(dir))
    await manager.trackTask({
      taskId: "bg_stuck_3",
      sessionID: "ses_stuck_3",
      parentSessionID: "ses_parent",
      description: "stuck task",
    })

    //#when
    const pending = manager.waitForAllDescendants("ses_parent", 60000, 50)
    pending.catch(() => {})
    manager.shutdown()

    //#then
    await expect(pending).rejects.toThrow()
    expect(manager.waiterCount()).toBe(0)
  })
})
