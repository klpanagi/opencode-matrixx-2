/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"

import { TaskStateManager } from "../../../src/features/background-agent/state"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function makeTask(id: string, overrides?: Partial<BackgroundTask>): BackgroundTask {
  return {
    id,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: `task ${id}`,
    prompt: "bench",
    agent: "task",
    status: "running",
    ...overrides,
  }
}

describe("TaskStateManager lookup index", () => {
  let state: TaskStateManager

  beforeEach(() => {
    state = new TaskStateManager()
  })

  test("findBySession returns task on index hit", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    const found = state.findBySession("ses_child_1")

    //#then
    expect(found?.id).toBe("bg_1")
  })

  test("findBySession returns undefined on index miss", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_child_1" }))
    state.findBySession("ses_child_1")

    //#when
    const found = state.findBySession("ses_missing")

    //#then
    expect(found).toBeUndefined()
  })

  test("removeTask removes task from index", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    state.removeTask("bg_1")

    //#then
    expect(state.findBySession("ses_child_1")).toBeUndefined()
  })

  test("clear empties the index", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    state.clear()

    //#then
    expect(state.findBySession("ses_child_1")).toBeUndefined()
    expect(state.tasks.size).toBe(0)
  })

  test("re-set of same id swaps index entry without duplicating", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_old" }))

    //#when
    state.addTask(makeTask("bg_1", { sessionID: "ses_new" }))

    //#then
    expect(state.findBySession("ses_old")).toBeUndefined()
    expect(state.findBySession("ses_new")?.id).toBe("bg_1")
  })

  test("getTasksByParentSession groups parents in insertion order", () => {
    //#given
    state.addTask(makeTask("bg_1", { parentSessionID: "p1" }))
    state.addTask(makeTask("bg_2", { parentSessionID: "p2" }))
    state.addTask(makeTask("bg_3", { parentSessionID: "p1" }))

    //#when
    const group = state.getTasksByParentSession("p1")

    //#then
    expect(group.map(t => t.id)).toEqual(["bg_1", "bg_3"])
  })

  test("lazily-assigned sessionID resolves on next lookup", () => {
    //#given
    const task = makeTask("bg_1")
    state.addTask(task)
    task.sessionID = "ses_late"

    //#when
    const found = state.findBySession("ses_late")

    //#then
    expect(found?.id).toBe("bg_1")
  })

  test("raw equality preserved: trailing-space session does not match", () => {
    //#given
    state.addTask(makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    const found = state.findBySession("ses_child_1 ")

    //#then
    expect(found).toBeUndefined()
  })
})
