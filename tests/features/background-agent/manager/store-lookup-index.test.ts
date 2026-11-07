/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ManagerStore } from "../../../../src/features/background-agent/manager/store"
import type { BackgroundTask } from "../../../../src/features/background-agent/types"

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

describe("ManagerStore lookup index", () => {
  let dir: string
  let store: ManagerStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mx-store-index-"))
    store = new ManagerStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("findBySession returns task on index hit", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    const found = store.findBySession("ses_child_1")

    //#then
    expect(found?.id).toBe("bg_1")
  })

  test("findBySession normalizes query and indexed keys", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1?x=1" }))

    //#when
    const found = store.findBySession("ses_child_1#frag")

    //#then
    expect(found?.id).toBe("bg_1")
  })

  test("findBySession returns undefined on index miss", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))
    store.findBySession("ses_child_1")

    //#when
    const found = store.findBySession("ses_missing")

    //#then
    expect(found).toBeUndefined()
  })

  test("delete removes task from index", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    store.tasks.delete("bg_1")

    //#then
    expect(store.findBySession("ses_child_1")).toBeUndefined()
  })

  test("clear empties the index", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

    //#when
    store.tasks.clear()

    //#then
    expect(store.findBySession("ses_child_1")).toBeUndefined()
    expect(store.tasks.size).toBe(0)
  })

  test("re-set of same id swaps index entry without duplicating", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_old" }))

    //#when
    store.tasks.set("bg_1", makeTask("bg_1", { sessionID: "ses_new" }))

    //#then
    expect(store.findBySession("ses_old")).toBeUndefined()
    expect(store.findBySession("ses_new")?.id).toBe("bg_1")
  })

  test("getTasksByParentSession groups parents in insertion order", () => {
    //#given
    store.tasks.set("bg_1", makeTask("bg_1", { parentSessionID: "p1" }))
    store.tasks.set("bg_2", makeTask("bg_2", { parentSessionID: "p2" }))
    store.tasks.set("bg_3", makeTask("bg_3", { parentSessionID: "p1" }))

    //#when
    const group = store.getTasksByParentSession("p1")

    //#then
    expect(group.map(t => t.id)).toEqual(["bg_1", "bg_3"])
  })

  test("lazily-assigned sessionID resolves on next lookup", () => {
    //#given
    const task = makeTask("bg_1")
    store.tasks.set("bg_1", task)
    task.sessionID = "ses_late"

    //#when
    const found = store.findBySession("ses_late")

    //#then
    expect(found?.id).toBe("bg_1")
  })
})
