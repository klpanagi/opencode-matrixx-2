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

describe("ManagerStore.reindexTask", () => {
  let dir: string
  let store: ManagerStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "store-reindex-"))
    store = new ManagerStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("re-indexes an in-place sessionID assigned after the last rebuild", () => {
    //#given
    const task = makeTask("bg_1")
    store.tasks.set("bg_1", task)
    // Force the miss path to rebuild over values while the task still has no sessionID.
    expect(store.findBySession("ses_absent")).toBeUndefined()
    expect(store.tasks.dirty).toBe(false)
    // Assign the session in place; the index is intentionally NOT updated.
    task.sessionID = "ses_late"
    expect(store.findBySession("ses_late")).toBeUndefined()

    //#when
    store.reindexTask(task)

    //#then
    expect(store.findBySession("ses_late")?.id).toBe("bg_1")
    expect(store.tasks.dirty).toBe(false)
  })

  test("does not disturb parent grouping order", () => {
    //#given
    const bg1 = makeTask("bg_1", { parentSessionID: "p1" })
    const bg2 = makeTask("bg_2", { parentSessionID: "p2" })
    const bg3 = makeTask("bg_3", { parentSessionID: "p1" })
    store.tasks.set("bg_1", bg1)
    store.tasks.set("bg_3", bg3)
    store.tasks.set("bg_2", bg2)
    expect(store.findBySession("ses_absent")).toBeUndefined()
    expect(store.tasks.dirty).toBe(false)
    bg3.sessionID = "ses_p3"

    //#when
    store.reindexTask(bg3)

    //#then
    expect(store.getTasksByParentSession("p1").map(t => t.id)).toEqual(["bg_1", "bg_3"])
  })

  test("reindexing the current owner is a no-op", () => {
    //#given
    const task = makeTask("bg_1", { sessionID: "ses_owned" })
    store.tasks.set("bg_1", task)

    //#when
    store.reindexTask(task)
    store.reindexTask(task)

    //#then
    expect(store.findBySession("ses_owned")?.id).toBe("bg_1")
    expect(store.tasks.size).toBe(1)
  })
})
