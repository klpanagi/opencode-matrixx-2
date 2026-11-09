/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeHandle } from "../../../src/features/background-agent/handle-index"
import { restoreHandles } from "../../../src/features/background-agent/manager/lifecycle"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import type { BackgroundTask, BackgroundTaskStatus } from "../../../src/features/background-agent/types"
import { createFakeClock } from "./harness/fake-clock"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

let dir: string
const runtimes: ManagerRuntimeFixture[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mx-restore-wallclock-"))
  runtimes.length = 0
})

afterEach(() => {
  for (const runtime of runtimes) {
    try {
      runtime.store.wallclock.disarmAll()
      runtime.dispose()
    } catch {
      // Best-effort cleanup between tests.
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

function createRuntime(options: {
  wallClockTimeoutMs?: number
  restoreReacquire?: boolean
  clockStart: number
}): ManagerRuntimeFixture {
  const config: ManagerRuntime["config"] =
    options.wallClockTimeoutMs === undefined
      ? undefined
      : { wallClockTimeoutMs: options.wallClockTimeoutMs }
  const runtime = createManagerRuntime({
    directory: dir,
    config,
    clock: createFakeClock(options.clockStart),
  })
  if (options.restoreReacquire === true) Object.assign(runtime, { restoreReacquire: true })
  runtimes.push(runtime)
  return runtime
}

function seedHandle(
  taskId: string,
  status: BackgroundTaskStatus,
  overrides: Partial<BackgroundTask>,
): void {
  const task: BackgroundTask = {
    id: taskId,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: `task ${taskId}`,
    prompt: "",
    agent: "explore",
    status,
    ...overrides,
  }
  writeHandle(dir, task)
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("restoreHandles wall-clock rehydration", () => {
  test("re-arms the wall clock for a re-adopted running handle", async () => {
    //#given a persisted running handle with a future deadline and liveness probe enabled
    const now = Date.now()
    seedHandle("bg_live", "running", {
      sessionID: "ses_live",
      startedAt: new Date(now - 5000),
      deadlineAt: new Date(now + 60000),
    })
    const runtime = createRuntime({
      wallClockTimeoutMs: 60000,
      restoreReacquire: true,
      clockStart: now,
    })

    //#when restoring
    await restoreHandles(runtime)

    //#then the task is running and the supervisor holds a live deadline
    const task = runtime.store.getTask("bg_live")
    expect(task?.status).toBe("running")
    expect(runtime.store.wallclock.getDeadlineAt("bg_live")).toBeDefined()
    expect(runtime.store.wallclock.size()).toBe(1)
  })

  test("fires the restored deadline and finalizes with wall-clock-timeout", async () => {
    //#given a re-adopted running handle whose persisted deadline is a few ms away
    const now = Date.now()
    seedHandle("bg_due", "running", {
      sessionID: "ses_live",
      startedAt: new Date(now - 5000),
      deadlineAt: new Date(now + 20),
    })
    const runtime = createRuntime({
      wallClockTimeoutMs: 60000,
      restoreReacquire: true,
      clockStart: now,
    })
    const notifications = recordNotifications(runtime)

    //#when restoring and letting the persisted deadline elapse
    await restoreHandles(runtime)
    await waitFor(() => runtime.store.getTask("bg_due")?.status === "error")

    //#then the task errors as a wall-clock timeout with no parent notification
    const task = runtime.store.getTask("bg_due")
    expect(task?.status).toBe("error")
    expect(task?.terminalReason).toBe("wall-clock-timeout")
    expect(task?.error).toBe("Wall-clock timeout exceeded")
    expect(notifications.calls.length).toBe(0)
    expect(runtime.store.wallclock.size()).toBe(0)
    notifications.dispose()
  })

  test("fires immediately when the persisted deadline is already in the past", async () => {
    //#given a re-adopted running handle whose deadline already elapsed
    const now = Date.now()
    seedHandle("bg_expired", "running", {
      sessionID: "ses_live",
      startedAt: new Date(now - 120000),
      deadlineAt: new Date(now - 1000),
    })
    const runtime = createRuntime({
      wallClockTimeoutMs: 60000,
      restoreReacquire: true,
      clockStart: now,
    })

    //#when restoring
    await restoreHandles(runtime)
    await waitFor(() => runtime.store.getTask("bg_expired")?.status === "error")

    //#then it terminates identically without waiting for a fresh budget
    const task = runtime.store.getTask("bg_expired")
    expect(task?.status).toBe("error")
    expect(task?.terminalReason).toBe("wall-clock-timeout")
    expect(task?.error).toBe("Wall-clock timeout exceeded")
    expect(runtime.store.wallclock.size()).toBe(0)
  })

  test("never arms a timer for a completed handle carrying a deadline", async () => {
    //#given a terminal handle that still carries a deadline
    const now = Date.now()
    seedHandle("bg_done", "completed", {
      startedAt: new Date(now - 5000),
      completedAt: new Date(now),
      deadlineAt: new Date(now + 60000),
    })
    const runtime = createRuntime({
      wallClockTimeoutMs: 60000,
      restoreReacquire: true,
      clockStart: now,
    })

    //#when restoring
    await restoreHandles(runtime)

    //#then the terminal task is restored but no timer is armed
    expect(runtime.store.getTask("bg_done")?.status).toBe("completed")
    expect(runtime.store.wallclock.size()).toBe(0)
  })

  test("never arms a timer when the wall clock is disabled", async () => {
    //#given a running handle with a deadline but a disabled wall clock
    const now = Date.now()
    seedHandle("bg_disabled", "running", {
      sessionID: "ses_live",
      startedAt: new Date(now - 5000),
      deadlineAt: new Date(now + 60000),
    })
    const runtime = createRuntime({
      wallClockTimeoutMs: 0,
      restoreReacquire: true,
      clockStart: now,
    })

    //#when restoring
    await restoreHandles(runtime)

    //#then the handle is re-adopted running but no timer is armed
    expect(runtime.store.getTask("bg_disabled")?.status).toBe("running")
    expect(runtime.store.wallclock.size()).toBe(0)
  })
})
