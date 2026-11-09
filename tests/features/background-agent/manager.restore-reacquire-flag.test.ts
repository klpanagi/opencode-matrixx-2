/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getHandlePath, readHandle, writeHandle } from "../../../src/features/background-agent/handle-index"
import { restoreHandles } from "../../../src/features/background-agent/manager/lifecycle"
import type { BackgroundTask, BackgroundTaskStatus } from "../../../src/features/background-agent/types"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

let dir: string
const runtimes: ManagerRuntimeFixture[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mx-restore-reacquire-"))
  runtimes.length = 0
})

afterEach(() => {
  for (const runtime of runtimes) {
    try {
      runtime.dispose()
    } catch {
      // Best-effort cleanup between tests.
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

function createRuntimeWithFlag(restoreReacquire?: boolean): ManagerRuntimeFixture {
  const runtime = createManagerRuntime({ directory: dir })
  runtimes.push(runtime)
  return Object.assign(runtime, restoreReacquire === undefined ? {} : { restoreReacquire })
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

describe("restoreHandles re-acquisition flag", () => {
  test("flag off reproduces all eight persisted status mappings", async () => {
    //#given eight handles on disk, one per status, restored with the flag absent
    seedHandle("bg_running", "running", { startedAt: new Date() })
    seedHandle("bg_pending", "pending")
    seedHandle("bg_completed", "completed", { completedAt: new Date() })
    seedHandle("bg_error", "error", { completedAt: new Date(), terminalReason: "no-output" })
    seedHandle("bg_cancelled", "cancelled", { completedAt: new Date(), terminalReason: "aborted" })
    seedHandle("bg_interrupt", "interrupt", { completedAt: new Date(), terminalReason: "aborted" })
    seedHandle("bg_stopped", "stopped", { completedAt: new Date(), terminalReason: "no-output" })
    seedHandle("bg_uncertain", "statusUncertain", { completedAt: new Date(), terminalReason: "uncertain" })
    const runtime = createRuntimeWithFlag()

    //#when restoring
    await restoreHandles(runtime)

    //#then running/pending degrade to statusUncertain and terminals are preserved
    const expected: Array<[string, BackgroundTaskStatus, string | undefined]> = [
      ["bg_running", "statusUncertain", "uncertain"],
      ["bg_pending", "statusUncertain", "uncertain"],
      ["bg_completed", "completed", undefined],
      ["bg_error", "error", "no-output"],
      ["bg_cancelled", "cancelled", "aborted"],
      ["bg_interrupt", "interrupt", "aborted"],
      ["bg_stopped", "stopped", "no-output"],
      ["bg_uncertain", "statusUncertain", "uncertain"],
    ]
    for (const [taskId, status, terminalReason] of expected) {
      const restored = runtime.store.getTask(taskId)
      expect(restored).toBeDefined()
      expect(restored?.status).toBe(status)
      expect(restored?.terminalReason).toBe(terminalReason)
    }
  })

  test("flag on with a failed probe falls back to statusUncertain", async () => {
    //#given a running handle with no sessionID so the probe reports it dead
    seedHandle("bg_probefail", "running", { startedAt: new Date() })
    const runtime = createRuntimeWithFlag(true)

    //#when restoring with re-acquisition enabled
    await restoreHandles(runtime)

    //#then the task degrades exactly like the flag-off path
    const task = runtime.store.getTask("bg_probefail")
    expect(task).toBeDefined()
    expect(task?.status).toBe("statusUncertain")
    expect(task?.terminalReason).toBe("uncertain")
  })

  test("flag on never adopts a corrupt handle file", async () => {
    //#given a running handle whose on-disk file is corrupted
    seedHandle("bg_corrupt", "running", { startedAt: new Date(), sessionID: "ses_live" })
    writeFileSync(getHandlePath(dir, "bg_corrupt"), "{ not json", "utf-8")
    const runtime = createRuntimeWithFlag(true)

    //#when restoring
    await restoreHandles(runtime)

    //#then the corrupt file is swept and never becomes a task
    expect(runtime.store.getTask("bg_corrupt")).toBeUndefined()
  })

  test("flag on with a live probe keeps the running status and re-persists the task", async () => {
    //#given a fresh running handle with a live session
    seedHandle("bg_alive", "running", { startedAt: new Date(), sessionID: "ses_live" })
    const runtime = createRuntimeWithFlag(true)

    //#when restoring with re-acquisition enabled
    await restoreHandles(runtime)

    //#then the task is re-adoptable with its live status and stays on disk
    const task = runtime.store.getTask("bg_alive")
    expect(task?.status).toBe("running")
    expect(task?.sessionID).toBe("ses_live")
    expect(readHandle(dir, "bg_alive")?.status).toBe("running")
  })

  test("flag never assigned behaves exactly like flag off", async () => {
    //#given a running handle and a runtime where restoreReacquire was never set
    seedHandle("bg_default", "running", { startedAt: new Date(), sessionID: "ses_live" })
    const runtime = createRuntimeWithFlag()

    //#when restoring
    await restoreHandles(runtime)

    //#then the default is off, so the running handle degrades
    const task = runtime.store.getTask("bg_default")
    expect(task?.status).toBe("statusUncertain")
    expect(task?.terminalReason).toBe("uncertain")
  })
})
