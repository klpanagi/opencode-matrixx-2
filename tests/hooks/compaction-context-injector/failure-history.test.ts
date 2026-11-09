/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { createCompactionContextInjector } from "../../../src/hooks/compaction-context-injector/hook"
import {
  COMPACTION_GOLDENS,
  type CompactionGolden,
} from "../../features/background-agent/fixtures/compaction-goldens"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
  type NotificationRecorder,
} from "../../features/background-agent/harness/manager-runtime.fixture"

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

function goldenFor(path: string): CompactionGolden {
  const row = COMPACTION_GOLDENS.find((candidate) => candidate.path === path)
  if (row === undefined) throw new Error(`missing compaction golden for ${path}`)
  return row
}

function seedTask(
  runtime: ManagerRuntimeFixture,
  id: string,
  sessionID: string,
  description: string,
): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description,
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

function compactionPrompt(runtime: ManagerRuntimeFixture): string {
  const injector = createCompactionContextInjector(runtime as unknown as BackgroundManager)
  return injector("ses_parent")
}

function historyStatus(runtime: ManagerRuntimeFixture, task: BackgroundTask): string | undefined {
  return runtime.taskHistory
    .getByParentSession(task.parentSessionID)
    .find((entry) => entry.id === task.id)?.status
}

describe("compaction context includes failed background tasks", () => {
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

  test("session.error is recorded to history and injected as compaction context", async () => {
    //#given
    const golden = goldenFor("session-error")
    const task = seedTask(runtime, "bg_err_history", golden.sessionID, golden.description)

    //#when
    await handleManagerEvent(
      runtime,
      terminalEvent("session.error", golden.sessionID, { message: "boom" }),
    )

    //#then
    expect(task.status).toBe("error")
    expect(historyStatus(runtime, task)).toBe("error")
    expect(compactionPrompt(runtime)).toContain(golden.line)
  })

  test("session.execution.failed is recorded to history and injected as compaction context", async () => {
    //#given
    const golden = goldenFor("execution-failed")
    const task = seedTask(runtime, "bg_fail_history", golden.sessionID, golden.description)

    //#when
    await handleManagerEvent(
      runtime,
      terminalEvent("session.execution.failed", golden.sessionID, { message: "bang" }),
    )

    //#then
    expect(task.status).toBe("error")
    expect(historyStatus(runtime, task)).toBe("error")
    expect(compactionPrompt(runtime)).toContain(golden.line)
  })

  test("wall-clock timeout is recorded to history and injected as compaction context", async () => {
    //#given
    const golden = goldenFor("wallclock")
    recorder.dispose()
    runtime.dispose()
    runtime = createManagerRuntime({ config: { wallClockTimeoutMs: 30 } })
    recorder = recordNotifications(runtime)
    const launched = await launchTask(runtime, {
      description: golden.description,
      prompt: "do work",
      agent: "task",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })

    //#when
    await new Promise((resolve) => setTimeout(resolve, 120))
    const task = runtime.store.getTask(launched.id) ?? launched

    //#then
    expect(task.status).toBe("error")
    expect(historyStatus(runtime, task)).toBe("error")
    expect(compactionPrompt(runtime)).toContain(golden.line)
  })
})
