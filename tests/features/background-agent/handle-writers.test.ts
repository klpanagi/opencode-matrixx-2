/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { readHandle } from "../../../src/features/background-agent/handle-index"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

const disposers: Array<() => void> = []

function makeRuntime(): ManagerRuntimeFixture {
  const runtime = createManagerRuntime()
  disposers.push(() => runtime.dispose())
  return runtime
}

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_writer001",
    sessionID: "ses_writer_child",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "Investigate the thing",
    prompt: "do the thing",
    agent: "explore",
    status: "running",
    queuedAt: new Date(0),
    startedAt: new Date(0),
    ...overrides,
  }
}

function toolPartEvent(sessionID: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "message.part.updated",
    data: {
      sessionID,
      time: 1_000,
      part: {
        id: "prt_writer001",
        sessionID,
        messageID: "msg_child",
        type: "tool",
        callID: "call_writer001",
        tool: "bash",
        state: { status: "running" },
      },
      ...overrides,
    },
  } as Parameters<typeof handleManagerEvent>[1]
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
})

describe("persistHandle liveness seed", () => {
  test("persisted handle carries a numeric lastActivityAt", () => {
    //#given a running task with no liveness timestamp
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)

    //#when the task is persisted
    runtime.store.persistHandle(task)

    //#then the written handle seeds a numeric lastActivityAt
    const handle = readHandle(runtime.directory, task.id)
    expect(handle).not.toBeNull()
    expect(typeof handle?.lastActivityAt).toBe("number")
  })

  test("re-persisting without activity does not bump lastActivityAt", () => {
    //#given a task already persisted once
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    const first = readHandle(runtime.directory, task.id)?.lastActivityAt

    //#when it is persisted again without any new activity
    runtime.store.persistHandle(task)

    //#then the seeded timestamp is unchanged
    const second = readHandle(runtime.directory, task.id)?.lastActivityAt
    expect(typeof first).toBe("number")
    expect(second).toBe(first)
  })
})

describe("reconcile progress projection", () => {
  test("projects tool progress from a message.part.updated event", async () => {
    //#given an active task registered under its child session
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)

    //#when reconcile handles a running tool part for that session
    await handleManagerEvent(runtime, toolPartEvent(task.sessionID as string))

    //#then the written handle carries the projected progress
    const handle = readHandle(runtime.directory, task.id)
    expect(handle).not.toBeNull()
    expect(handle?.progress).toBeDefined()
    expect(handle?.progress?.toolCalls).toBe(1)
    expect(handle?.progress?.lastTool).toBe("bash")
    expect(handle?.progress?.lastUpdate).toBe(1_000)
  })

  test("legacy-shaped task with no progress still writes a valid handle", () => {
    //#given a task with no progress field at all
    const runtime = makeRuntime()
    const task = makeTask({ progress: undefined })
    runtime.store.tasks.set(task.id, task)

    //#when the task is persisted
    runtime.store.persistHandle(task)

    //#then the handle is valid and progress stays absent
    const handle = readHandle(runtime.directory, task.id)
    expect(handle).not.toBeNull()
    expect(handle?.progress).toBeUndefined()
  })
})
