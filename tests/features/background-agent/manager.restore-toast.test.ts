/// <reference types="bun-types" />
/**
 * T-30 — toast lifecycle across restore.
 *
 * `restoreHandles` must register a toast for every restored LIVE task so the
 * consolidated toast list survives a process restart. Non-live statuses stay
 * out of the toast list, and a restored live task drops its toast when it
 * finalizes through the normal terminal path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeHandle } from "../../../src/features/background-agent/handle-index"
import { restoreHandles } from "../../../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask, BackgroundTaskStatus } from "../../../src/features/background-agent/types"
import {
  _resetTaskToastManagerForTesting,
  getTaskToastManager,
  initTaskToastManager,
} from "../../../src/features/task-toast-manager/manager"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

let dir: string
const runtimes: ManagerRuntimeFixture[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mx-restore-toast-"))
  runtimes.length = 0
  _resetTaskToastManagerForTesting()
  initTaskToastManager()
})

afterEach(() => {
  _resetTaskToastManagerForTesting()
  for (const runtime of runtimes) {
    try {
      runtime.dispose()
    } catch {
      // Best-effort cleanup between tests.
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

function createRuntime(restoreReacquire: boolean): ManagerRuntimeFixture {
  const runtime = createManagerRuntime({ directory: dir })
  runtimes.push(runtime)
  return Object.assign(runtime, { restoreReacquire })
}

function seedHandle(
  taskId: string,
  status: BackgroundTaskStatus,
  overrides: Partial<BackgroundTask> = {},
): void {
  const task: BackgroundTask = {
    id: taskId,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: `task ${taskId}`,
    prompt: "",
    agent: "explore",
    status,
    queuedAt: new Date(),
    ...overrides,
  }
  writeHandle(dir, task)
}

function trackedIds(): string[] {
  return (getTaskToastManager()?.getRunningTasks() ?? []).map((task) => task.id)
}

function queuedIds(): string[] {
  return (getTaskToastManager()?.getQueuedTasks() ?? []).map((task) => task.id)
}

function terminalEvent(type: string, sessionID: string): HandleEventArg {
  return { type, sessionID, data: { sessionID } } as unknown as HandleEventArg
}

describe("restoreHandles toast registration", () => {
  test("restored running live task is tracked as running", async () => {
    //#given a live running handle and re-acquisition enabled
    seedHandle("bg_toast_running", "running", {
      startedAt: new Date(),
      sessionID: "ses_live_running",
    })
    const runtime = createRuntime(true)

    //#when restoring
    await restoreHandles(runtime)

    //#then its toast is registered as a running background task
    expect(runtime.store.getTask("bg_toast_running")?.status).toBe("running")
    expect(trackedIds()).toContain("bg_toast_running")
    const tracked = getTaskToastManager()?.getRunningTasks().find((task) => task.id === "bg_toast_running")
    expect(tracked?.isBackground).toBe(true)
    expect(tracked?.status).toBe("running")
  })

  test("restored pending live task is tracked as queued", async () => {
    //#given a live pending handle and re-acquisition enabled
    seedHandle("bg_toast_pending", "pending", { sessionID: "ses_live_pending" })
    const runtime = createRuntime(true)

    //#when restoring
    await restoreHandles(runtime)

    //#then its toast is registered in the queued bucket, never as running
    expect(runtime.store.getTask("bg_toast_pending")?.status).toBe("pending")
    expect(queuedIds()).toContain("bg_toast_pending")
    expect(trackedIds()).not.toContain("bg_toast_pending")
  })

  test("restored completed task is not tracked", async () => {
    //#given a terminal completed handle
    seedHandle("bg_toast_completed", "completed", {
      startedAt: new Date(),
      completedAt: new Date(),
    })
    const runtime = createRuntime(true)

    //#when restoring
    await restoreHandles(runtime)

    //#then no toast entry is created for the terminal task
    expect(runtime.store.getTask("bg_toast_completed")?.status).toBe("completed")
    expect(trackedIds()).not.toContain("bg_toast_completed")
    expect(queuedIds()).not.toContain("bg_toast_completed")
  })

  test("restored running live task drops its toast on session.idle finalize", async () => {
    //#given a restored live running task that has a toast entry
    seedHandle("bg_toast_idle", "running", {
      startedAt: new Date(),
      sessionID: "ses_live_idle",
    })
    const runtime = createRuntime(true)
    await restoreHandles(runtime)
    expect(trackedIds()).toContain("bg_toast_idle")

    //#when the terminal session.idle event arrives
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_live_idle"))

    //#then the task finalizes and its toast entry is removed
    expect(runtime.store.getTask("bg_toast_idle")?.status).toBe("completed")
    expect(trackedIds()).not.toContain("bg_toast_idle")
  })
})
