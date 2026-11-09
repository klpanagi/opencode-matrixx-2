/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { readHandles } from "../../../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import {
  registerSubagentSession,
  subagentSessions,
  unregisterSubagentSession,
} from "../../../src/features/session-state/state"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

const PARENT = "ses_parent"
const SESSION = "ses_phantomsync"

function seedTask(
  rt: ManagerRuntimeFixture,
  id: string,
  sessionID: string,
): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: PARENT,
    parentMessageID: "msg_1",
    description: "already covered task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    startedAt: new Date(0),
  }
  rt.store.tasks.set(task.id, task)
  return task
}

function seedDelegationHandle(
  rt: ManagerRuntimeFixture,
  taskId: string,
  sessionID: string,
): void {
  const marker: BackgroundTask = {
    id: taskId,
    sessionID,
    parentSessionID: PARENT,
    parentMessageID: "msg_1",
    description: "delegated task marker",
    prompt: "",
    agent: "native",
    status: "running",
    startedAt: new Date(0),
    origin: "delegation",
  }
  rt.store.persistHandle(marker)
}

describe("handleManagerEvent phantom-sync origin gate", () => {
  let rt: ManagerRuntimeFixture

  beforeEach(() => {
    //#given
    rt = createManagerRuntime()
  })

  afterEach(() => {
    unregisterSubagentSession(SESSION)
    rt.dispose()
  })

  test("negative uncovered: known parent + active delegation + no persisted origin ⇒ no task, no notification", async () => {
    //#given
    registerSubagentSession(SESSION, PARENT)
    const notifications = recordNotifications(rt)
    expect(rt.store.tasks.size).toBe(0)

    //#when
    await handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: SESSION },
    })

    //#then
    expect({
      tasks: rt.store.tasks.size,
      phantomNative: [...rt.store.tasks.values()].some(
        (task) => task.agent === "native",
      ),
      notifications: notifications.calls.length,
      handles: readHandles(rt.directory).length,
    }).toEqual({
      tasks: 0,
      phantomNative: false,
      notifications: 0,
      handles: 0,
    })
    notifications.dispose()
  })

  test("covered-session regression: existing task ⇒ no new task, no new handle", async () => {
    //#given
    const covered = seedTask(rt, "bg_covered_1", SESSION)
    registerSubagentSession(SESSION, PARENT)

    //#when
    await handleManagerEvent(rt, {
      type: "session.created",
      data: { sessionID: SESSION },
    })

    //#then
    expect(rt.store.tasks.size).toBe(1)
    expect(rt.store.findBySession(SESSION)).toBe(covered)
    expect(readHandles(rt.directory)).toHaveLength(0)
  })

  test("adoption positive: persisted delegation origin + active delegation ⇒ exactly 1 adopted task and 1 handle", async () => {
    //#given
    seedDelegationHandle(rt, "bg_delegated_1", SESSION)
    registerSubagentSession(SESSION, PARENT)

    //#when
    await handleManagerEvent(rt, {
      type: "session.created",
      data: { sessionID: SESSION },
    })

    //#then
    expect(rt.store.tasks.size).toBe(1)
    const adopted = [...rt.store.tasks.values()].find(
      (task) => task.sessionID === SESSION,
    )
    expect(adopted).toBeDefined()
    expect(adopted?.agent).toBe("native")
    expect(adopted?.origin).toBe("delegation")
    expect(adopted?.status).toBe("running")
    expect(readHandles(rt.directory)).toHaveLength(1)
  })

  test("both factors required: persisted origin without active delegation record ⇒ skip", async () => {
    //#given
    seedDelegationHandle(rt, "bg_delegated_orphan", SESSION)
    registerSubagentSession(SESSION, PARENT)
    subagentSessions.delete(SESSION)

    //#when
    await handleManagerEvent(rt, {
      type: "session.created",
      data: { sessionID: SESSION },
    })

    //#then
    expect(rt.store.tasks.size).toBe(0)
    expect(readHandles(rt.directory)).toHaveLength(1)
  })

  test("launch-path control: findBySession path, not adoption", async () => {
    //#given
    const launched = seedTask(rt, "bg_launched_1", SESSION)
    registerSubagentSession(SESSION, PARENT)

    //#when
    await handleManagerEvent(rt, {
      type: "session.created",
      data: { sessionID: SESSION },
    })

    //#then
    expect(rt.store.tasks.size).toBe(1)
    expect(rt.store.tasks.get("bg_launched_1")).toBe(launched)
    expect(readHandles(rt.directory)).toHaveLength(0)
  })
})
