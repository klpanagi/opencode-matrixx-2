/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ManagerStore } from "../../../../src/features/background-agent/manager/store"
import type { BackgroundTask } from "../../../../src/features/background-agent/types"

function makeTask(id: string, parentSessionID: string, sessionID?: string): BackgroundTask {
  return {
    id,
    parentSessionID,
    parentMessageID: `msg_${id}`,
    description: id,
    prompt: "prompt",
    agent: "task",
    status: "running",
    sessionID,
  }
}

describe("ManagerStore.getAllDescendantTasks single pass", () => {
  let dir: string
  let store: ManagerStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mx-descendants-"))
    store = new ManagerStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns descendants in the recursive preorder of the previous implementation", () => {
    //#given
    store.tasks.set("a", makeTask("a", "root", "ses_a"))
    store.tasks.set("a1", makeTask("a1", "ses_a", "ses_a1"))
    store.tasks.set("a1x", makeTask("a1x", "ses_a1", "ses_a1x"))
    store.tasks.set("a2", makeTask("a2", "ses_a", "ses_a2"))
    store.tasks.set("b", makeTask("b", "root", "ses_b"))
    store.tasks.set("b1", makeTask("b1", "ses_b", "ses_b1"))

    //#when
    const descendants = store.getAllDescendantTasks("root")

    //#then
    expect(descendants.map(task => task.id)).toEqual(["a", "a1", "a1x", "a2", "b", "b1"])
  })

  test("walks a deep chain without dropping or duplicating tasks", () => {
    //#given
    const depth = 300
    for (let index = 0; index < depth; index++) {
      const parent = index === 0 ? "root" : `ses_${index - 1}`
      store.tasks.set(`t${index}`, makeTask(`t${index}`, parent, `ses_${index}`))
    }

    //#when
    const descendants = store.getAllDescendantTasks("root")

    //#then
    expect(descendants).toHaveLength(depth)
    expect(descendants[0]?.id).toBe("t0")
    expect(descendants[depth - 1]?.id).toBe(`t${depth - 1}`)
    expect(new Set(descendants.map(task => task.id)).size).toBe(depth)
  })

  test("returns an empty list for a session with no children", () => {
    //#given
    store.tasks.set("a", makeTask("a", "root", "ses_a"))

    //#when
    const descendants = store.getAllDescendantTasks("ses_a")

    //#then
    expect(descendants).toEqual([])
  })
})
