/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { readHandles } from "../../../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { TERMINAL_GOLDENS, type TerminalGolden } from "./fixtures/terminal-goldens"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
  type NotificationRecorder,
} from "./harness/manager-runtime.fixture"

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

function seedTask(runtime: ManagerRuntimeFixture, id: string, sessionID: string): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "characterization task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(0),
  }
  runtime.store.tasks.set(task.id, task)
  return task
}

function terminalEvent(type: string, sessionID: string, error?: Record<string, unknown>): HandleEventArg {
  return {
    type,
    sessionID,
    data: { sessionID, ...(error !== undefined ? { error } : {}) },
  } as unknown as HandleEventArg
}

function goldenFor(path: string): TerminalGolden {
  const row = TERMINAL_GOLDENS.find((candidate) => candidate.path === path)
  if (row === undefined) throw new Error(`missing golden for ${path}`)
  return row
}

function notificationText(call: unknown): string {
  if (typeof call !== "object" || call === null) return ""
  const text = (call as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

function historyStatus(runtime: ManagerRuntimeFixture, task: BackgroundTask): string | undefined {
  return runtime.taskHistory
    .getByParentSession(task.parentSessionID)
    .find((entry) => entry.id === task.id)?.status
}

function assertGolden(
  runtime: ManagerRuntimeFixture,
  recorder: NotificationRecorder,
  task: BackgroundTask,
  golden: TerminalGolden,
): void {
  expect(task.status).toBe(golden.status as BackgroundTask["status"])
  expect(historyStatus(runtime, task) === golden.status).toBe(golden.historyRecorded)

  expect(recorder.calls.length).toBe(golden.notifications)
  expect(recorder.calls.some((call) => notificationText(call).includes("**Error:**"))).toBe(
    golden.bodyIncludesError,
  )

  expect(typeof task.error === "string" && task.error.length > 0).toBe(golden.errorOnTask)
  const handle = readHandles(runtime.directory).find((candidate) => candidate.taskId === task.id)
  expect(typeof handle?.error === "string" && handle.error.length > 0).toBe(golden.errorOnHandle)
}

describe("terminal path characterization (behaviour-neutral finalizer)", () => {
  let runtime: ManagerRuntimeFixture
  let recorder: NotificationRecorder

  beforeEach(() => {
    runtime = createManagerRuntime()
    recorder = recordNotifications(runtime)
  })

  afterEach(() => {
    recorder.dispose()
    runtime.dispose()
  })

  test("session.idle", async () => {
    //#given
    const task = seedTask(runtime, "bg_idle", "ses_idle")

    //#when
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_idle"))

    //#then
    assertGolden(runtime, recorder, task, goldenFor("session.idle"))
  })

  test("session.execution.succeeded", async () => {
    //#given
    const task = seedTask(runtime, "bg_ok", "ses_ok")

    //#when
    await handleManagerEvent(runtime, terminalEvent("session.execution.succeeded", "ses_ok"))

    //#then
    assertGolden(runtime, recorder, task, goldenFor("session.execution.succeeded"))
  })

  test("session.error", async () => {
    //#given
    const task = seedTask(runtime, "bg_err", "ses_err")

    //#when
    await handleManagerEvent(
      runtime,
      terminalEvent("session.error", "ses_err", { message: "boom" }),
    )

    //#then
    assertGolden(runtime, recorder, task, goldenFor("session.error"))
  })

  test("session.execution.failed", async () => {
    //#given
    const task = seedTask(runtime, "bg_fail", "ses_fail")

    //#when
    await handleManagerEvent(
      runtime,
      terminalEvent("session.execution.failed", "ses_fail", { message: "bang" }),
    )

    //#then
    assertGolden(runtime, recorder, task, goldenFor("session.execution.failed"))
  })

  test("cancel", async () => {
    //#given
    let dir = ""
    runtime.dispose()
    dir = mkdtempSync(join(tmpdir(), "mx-finalize-cancel-"))
    const native = {
      session: {
        create: async () => ({ id: "ses_cancel" }),
        prompt: async () => ({}),
        interrupt: async () => ({}),
      },
      agent: { list: async () => [] },
      model: { list: async () => [] },
    }
    const manager = new BackgroundManager({ ...native, directory: dir } as unknown as MatrixxContext)
    const cancelRecorder = recordNotifications(manager)
    const task: BackgroundTask = {
      id: "bg_cancel",
      sessionID: "ses_cancel",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "cancel task",
      prompt: "do work",
      agent: "task",
      status: "running",
      startedAt: new Date(0),
    }
    manager.tasks.set(task.id, task)

    try {
      //#when
      await manager.cancelTask(task.id)

      //#then
      expect(task.status).toBe("cancelled")
      expect(
        manager.taskHistory
          .getByParentSession(task.parentSessionID)
          .find((entry) => entry.id === task.id)?.status,
      ).toBe("cancelled")
      expect(cancelRecorder.calls.length).toBe(0)
      const handle = readHandles(dir).find((candidate) => candidate.taskId === task.id)
      expect(handle?.status).toBe("cancelled")
      expect(handle?.error).toBeUndefined()
    } finally {
      cancelRecorder.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("wall-clock timeout", async () => {
    //#given
    runtime.dispose()
    runtime = createManagerRuntime({ config: { wallClockTimeoutMs: 30 } })
    recorder = recordNotifications(runtime)
    const launched = await launchTask(runtime, {
      description: "wallclock task",
      prompt: "do work",
      agent: "task",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })

    //#when
    await new Promise((resolve) => setTimeout(resolve, 120))
    const task = runtime.store.getTask(launched.id) ?? launched

    //#then
    assertGolden(runtime, recorder, task, goldenFor("wall-clock"))
    expect(task.error).toBe("Wall-clock timeout exceeded")
  })
})
