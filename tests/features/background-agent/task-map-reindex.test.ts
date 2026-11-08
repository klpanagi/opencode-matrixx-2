/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"

import { TaskMap } from "../../../src/features/background-agent/task-map"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function makeTask(id: string, parentSessionID = "ses_parent"): BackgroundTask {
  return {
    id,
    parentSessionID,
    parentMessageID: "msg_1",
    description: `task ${id}`,
    prompt: "bench",
    agent: "task",
    status: "running",
  }
}

describe("TaskMap.reindexSession", () => {
  let map: TaskMap<BackgroundTask>

  beforeEach(() => {
    map = new TaskMap()
  })

  test("reindexSession indexes a lazily assigned sessionID while dirty stays false", () => {
    //#given
    const task = makeTask("bg_1")
    map.set("bg_1", task)
    map.dirty = false
    task.sessionID = "ses_late"

    //#when
    const before = map.bySession("ses_late")
    map.reindexSession(task)

    //#then
    expect(before).toBeUndefined()
    expect(map.bySession("ses_late")?.id).toBe("bg_1")
    expect(map.dirty).toBe(false)
  })

  test("reindexSession leaves parent index order untouched", () => {
    //#given
    const bg1 = makeTask("bg_1", "p1")
    const bg2 = makeTask("bg_2", "p2")
    const bg3 = makeTask("bg_3", "p1")
    map.set("bg_1", bg1)
    map.set("bg_2", bg2)
    map.set("bg_3", bg3)
    bg1.sessionID = "ses_p1"

    //#when
    map.reindexSession(bg1)

    //#then
    expect(map.byParent("p1").map((t) => t.id)).toEqual(["bg_1", "bg_3"])
    expect(map.bySession("ses_p1")?.id).toBe("bg_1")
  })

  test("reindexSession keeps the first owner on conflict and does not throw", () => {
    //#given
    const first = makeTask("bg_1")
    first.sessionID = "ses_x"
    const second = makeTask("bg_2")
    map.set("bg_1", first)
    map.set("bg_2", second)
    second.sessionID = "ses_x"

    //#when
    const run = () => map.reindexSession(second)

    //#then
    expect(run).not.toThrow()
    expect(map.bySession("ses_x")?.id).toBe("bg_1")
    expect(map.size).toBe(2)
  })

  test("reindexSession is a no-op when sessionID is undefined or empty", () => {
    //#given
    const task = makeTask("bg_1")
    map.set("bg_1", task)
    map.dirty = false

    //#when
    map.reindexSession(task)
    task.sessionID = ""
    map.reindexSession(task)

    //#then
    expect(map.bySession("")).toBeUndefined()
    expect(map.size).toBe(1)
    expect(map.dirty).toBe(false)
  })
})
