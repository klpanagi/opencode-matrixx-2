/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"

import { finalizeTask } from "../../../src/features/background-agent/manager/finalize"
import {
  handleManagerEvent,
  reviveTask,
} from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
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
    description: "generation-notify task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(0),
  }
  runtime.store.tasks.set(task.id, task)
  return task
}

function seedCompletedTask(
  runtime: ManagerRuntimeFixture,
  id: string,
  sessionID: string,
): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "revivable task",
    prompt: "old prompt",
    agent: "task",
    status: "completed",
    startedAt: new Date(0),
    completedAt: new Date(1),
  }
  runtime.store.persistHandle(task)
  return task
}

function terminalEvent(type: string, sessionID: string): HandleEventArg {
  return {
    type,
    sessionID,
    data: { sessionID },
  } as unknown as HandleEventArg
}

function goldenFor(path: string): TerminalGolden {
  const row = TERMINAL_GOLDENS.find((candidate) => candidate.path === path)
  if (row === undefined) throw new Error(`missing golden for ${path}`)
  return row
}

function historyRowCount(runtime: ManagerRuntimeFixture, task: BackgroundTask): number {
  return runtime.taskHistory
    .getByParentSession(task.parentSessionID)
    .filter((entry) => entry.id === task.id).length
}

describe("finalize generation gate + single notification", () => {
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

  test("stale finalize after a generation bump mutates nothing and notifies nobody", async () => {
    //#given
    const task = seedTask(runtime, "bg_stale", "ses_stale")
    runtime.store.persistHandle(task)
    task.generation = 0
    const completedAtBefore = task.completedAt
    const statusBefore = task.status
    runtime.store.bumpTaskGeneration(task.id)

    //#when
    const result = await finalizeTask(runtime, task, {
      status: "completed",
      source: "stale-terminal-event",
      notify: true,
      removeToast: true,
      recordHistory: true,
    })

    //#then
    expect(runtime.store.currentGeneration(task.id)).toBeGreaterThan(task.generation)
    expect(recorder.calls.length).toBe(0)
    expect(task.status).toBe(statusBefore)
    expect(task.completedAt).toBe(completedAtBefore)
    expect(historyRowCount(runtime, task)).toBe(0)
    expect(result.effortLine).toBeUndefined()
  })

  test("fresh finalize with matching generation notifies exactly once", async () => {
    //#given
    const task = seedTask(runtime, "bg_fresh", "ses_fresh")
    runtime.store.persistHandle(task)
    task.generation = runtime.store.currentGeneration(task.id)

    //#when
    await finalizeTask(runtime, task, {
      status: "completed",
      source: "fresh-terminal-event",
      notify: true,
      removeToast: true,
      recordHistory: true,
    })

    //#then
    expect(task.status).toBe("completed")
    expect(recorder.calls.length).toBe(1)
    expect(historyRowCount(runtime, task)).toBe(1)
  })

  test("revive then stale replay yields golden notification count, not a duplicate", async () => {
    //#given
    const stale = seedCompletedTask(runtime, "bg_revivegate", "ses_revivegate")
    stale.generation = 0
    await reviveTask(runtime, {
      taskId: stale.id,
      prompt: "revive prompt",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_revive",
    })

    //#when — replay a terminal event against the pre-revive object
    await finalizeTask(runtime, stale, {
      status: "completed",
      source: "stale-terminal-event",
      notify: true,
      removeToast: true,
      recordHistory: true,
    })
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_revivegate"))

    //#then
    const golden = goldenFor("session.idle")
    expect(recorder.calls.length).toBe(golden.notifications)
    const revived = runtime.store.getTask(stale.id)
    expect(revived?.status).toBe("completed")
    expect(stale.status).toBe("completed")
  })
})
