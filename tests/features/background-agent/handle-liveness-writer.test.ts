/// <reference types="bun-types" />
/**
 * T-23a — event-time `lastActivityAt` writer.
 *
 * Once a task is resolved and confirmed active, `handleManagerEvent` must stamp
 * `task.lastActivityAt` from the event's own timestamp (falling back to the
 * injected clock) before the event-specific branch runs. The stamp must be
 * idempotent within a millisecond: two events carrying the same millisecond
 * produce the same `Date` value.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readHandle } from "../../../src/features/background-agent/handle-index"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { createFakeClock } from "./harness/fake-clock"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

const disposers: Array<() => void> = []

function makeRuntime(): ManagerRuntimeFixture {
  const runtime = createManagerRuntime({ clock: createFakeClock(1_000_000) })
  disposers.push(() => runtime.dispose())
  return runtime
}

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_liveness001",
    sessionID: "ses_liveness_child",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "Watch the liveness writer",
    prompt: "do the thing",
    agent: "explore",
    status: "running",
    queuedAt: new Date(0),
    startedAt: new Date(0),
    ...overrides,
  }
}

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

function partEvent(sessionID: string, time?: number): HandleEventArg {
  const data: Record<string, unknown> = {
    sessionID,
    part: {
      id: "prt_liveness001",
      sessionID,
      messageID: "msg_child",
      type: "tool",
      callID: "call_liveness001",
      tool: "bash",
      state: { status: "running" },
    },
  }
  if (time !== undefined) data.time = time
  return { type: "message.part.updated", data } as unknown as HandleEventArg
}

function idleEvent(sessionID: string, time?: number): HandleEventArg {
  const data: Record<string, unknown> = { sessionID }
  if (time !== undefined) data.time = time
  return { type: "session.idle", data } as unknown as HandleEventArg
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
})

describe("event-time lastActivityAt writer", () => {
  test("message.part.updated stamps the event time over the persisted seed", async () => {
    //#given a running task whose handle was persisted (seeding lastActivityAt)
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    const seed = task.lastActivityAt?.getTime() ?? -1
    runtime.clock.advance(5_000)
    const eventTime = runtime.clock.now()

    //#when an event carrying that event-time timestamp arrives
    await handleManagerEvent(runtime, partEvent(task.sessionID as string, eventTime))

    //#then lastActivityAt (and the persisted handle) reflects the event time, not the seed
    expect(eventTime).not.toBe(seed)
    expect(task.lastActivityAt?.getTime()).toBe(eventTime)
    expect(readHandle(runtime.directory, task.id)?.lastActivityAt).toBe(eventTime)
  })

  test("event without a payload timestamp falls back to the injected clock", async () => {
    //#given an active task persisted at seed time
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    runtime.clock.advance(7_000)
    const expected = runtime.clock.now()

    //#when an event carrying no timestamp arrives
    await handleManagerEvent(runtime, partEvent(task.sessionID as string))

    //#then the clock value is used
    expect(task.lastActivityAt?.getTime()).toBe(expected)
    expect(readHandle(runtime.directory, task.id)?.lastActivityAt).toBe(expected)
  })

  test("two events in the same millisecond yield the same lastActivityAt", async () => {
    //#given an active task
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    runtime.clock.advance(3_000)
    const eventTime = runtime.clock.now()

    //#when two events carry the same millisecond timestamp
    await handleManagerEvent(runtime, partEvent(task.sessionID as string, eventTime))
    const first = task.lastActivityAt?.getTime()
    await handleManagerEvent(runtime, partEvent(task.sessionID as string, eventTime))
    const second = task.lastActivityAt?.getTime()

    //#then the value is idempotent within that millisecond
    expect(first).toBe(eventTime)
    expect(second).toBe(first)
    expect(readHandle(runtime.directory, task.id)?.lastActivityAt).toBe(first)
  })

  test("nested properties.time is honoured when present", async () => {
    //#given an active task and an event whose timestamp sits under properties
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    const eventTime = 1_234_567

    //#when the event arrives with the timestamp nested under properties
    await handleManagerEvent(runtime, {
      type: "message.part.updated",
      data: {
        sessionID: task.sessionID,
        properties: { time: eventTime },
        part: { type: "text" },
      },
    } as unknown as HandleEventArg)

    //#then the nested event time wins over the clock
    expect(task.lastActivityAt?.getTime()).toBe(eventTime)
    expect(readHandle(runtime.directory, task.id)?.lastActivityAt).toBe(eventTime)
  })

  test("terminal session.idle stamps the event time before finalizing", async () => {
    //#given a running task whose session produced real output
    const runtime = makeRuntime()
    const task = makeTask()
    runtime.store.tasks.set(task.id, task)
    runtime.store.persistHandle(task)
    runtime.clock.advance(9_000)
    const eventTime = runtime.clock.now()

    //#when the terminal idle event arrives with an event-time timestamp
    await handleManagerEvent(runtime, idleEvent(task.sessionID as string, eventTime))

    //#then finalization keeps the event-time stamp on task and handle
    expect(task.status).toBe("completed")
    expect(task.lastActivityAt?.getTime()).toBe(eventTime)
    expect(readHandle(runtime.directory, task.id)?.lastActivityAt).toBe(eventTime)
  })
})
