/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"

import { TaskMap } from "../../../src/features/background-agent/task-map"
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

describe("TaskMap", () => {
  let map: TaskMap<BackgroundTask>

  beforeEach(() => {
    map = new TaskMap()
  })

  describe("session index", () => {
    test("bySession returns task inserted with sessionID", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

      //#when
      const found = map.bySession("ses_child_1")

      //#then
      expect(found?.id).toBe("bg_1")
    })

    test("bySession returns undefined for unknown session", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

      //#when
      const found = map.bySession("ses_missing")

      //#then
      expect(found).toBeUndefined()
    })

    test("delete removes task from session index", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

      //#when
      map.delete("bg_1")

      //#then
      expect(map.bySession("ses_child_1")).toBeUndefined()
    })

    test("clear empties the session index", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_child_1" }))

      //#when
      map.clear()

      //#then
      expect(map.bySession("ses_child_1")).toBeUndefined()
      expect(map.size).toBe(0)
    })

    test("re-set of same id swaps index entry without duplicating", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_old" }))

      //#when
      map.set("bg_1", makeTask("bg_1", { sessionID: "ses_new" }))

      //#then
      expect(map.bySession("ses_old")).toBeUndefined()
      expect(map.bySession("ses_new")?.id).toBe("bg_1")
      expect(map.size).toBe(1)
    })
  })

  describe("parent index", () => {
    test("byParent groups tasks by parentSessionID in insertion order", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { parentSessionID: "p1" }))
      map.set("bg_2", makeTask("bg_2", { parentSessionID: "p2" }))
      map.set("bg_3", makeTask("bg_3", { parentSessionID: "p1" }))

      //#when
      const group = map.byParent("p1")

      //#then
      expect(group.map(t => t.id)).toEqual(["bg_1", "bg_3"])
    })

    test("byParent returns empty array for unknown parent", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { parentSessionID: "p1" }))

      //#when
      const group = map.byParent("p_missing")

      //#then
      expect(group).toEqual([])
    })

    test("delete removes task from parent group", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { parentSessionID: "p1" }))
      map.set("bg_2", makeTask("bg_2", { parentSessionID: "p1" }))

      //#when
      map.delete("bg_1")

      //#then
      expect(map.byParent("p1").map(t => t.id)).toEqual(["bg_2"])
    })

    test("clear empties the parent index", () => {
      //#given
      map.set("bg_1", makeTask("bg_1", { parentSessionID: "p1" }))

      //#when
      map.clear()

      //#then
      expect(map.byParent("p1")).toEqual([])
    })
  })

  describe("dirty flag and rebuild", () => {
    test("set marks dirty", () => {
      //#given
      map.dirty = false

      //#when
      map.set("bg_1", makeTask("bg_1"))

      //#then
      expect(map.dirty).toBe(true)
    })

    test("delete marks dirty", () => {
      //#given
      map.set("bg_1", makeTask("bg_1"))
      map.dirty = false

      //#when
      map.delete("bg_1")

      //#then
      expect(map.dirty).toBe(true)
    })

    test("clear marks dirty", () => {
      //#given
      map.set("bg_1", makeTask("bg_1"))
      map.dirty = false

      //#when
      map.clear()

      //#then
      expect(map.dirty).toBe(true)
    })

    test("rebuild picks up lazily-assigned sessionID and clears dirty", () => {
      //#given
      const task = makeTask("bg_1")
      map.set("bg_1", task)
      task.sessionID = "ses_late"

      //#when
      const before = map.bySession("ses_late")
      map.rebuild()
      const after = map.bySession("ses_late")

      //#then
      expect(before).toBeUndefined()
      expect(after?.id).toBe("bg_1")
      expect(map.dirty).toBe(false)
    })
  })

  describe("Map compatibility", () => {
    test("still behaves as a Map for get/size/values", () => {
      //#given
      const task = makeTask("bg_1")

      //#when
      map.set("bg_1", task)

      //#then
      expect(map).toBeInstanceOf(Map)
      expect(map.get("bg_1")).toBe(task)
      expect(map.size).toBe(1)
      expect([...map.values()]).toEqual([task])
    })
  })
})
