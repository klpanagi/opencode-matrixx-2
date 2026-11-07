/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import { DEFAULT_STALE_AFTER_HOURS, getStaleAfterMs, isTaskStale, filterFreshIncompleteTasks } from "../../src/features/task-session-scope/staleness"
import { getIncompleteCount, getIncompleteTasks, filterTasksBySession } from "../../src/features/task-session-scope/todo"
import { HookNameSchema } from "../../src/config/schema/hooks"

describe("task-session-scope relocated helpers", () => {
  test("staleness helpers importable from new path", () => {
    //#given
    const hours = DEFAULT_STALE_AFTER_HOURS
    //#when
    const ms = getStaleAfterMs(undefined)
    //#then
    expect(hours).toBe(24)
    expect(ms).toBe(24 * 60 * 60 * 1000)
    expect(typeof isTaskStale).toBe("function")
    expect(typeof filterFreshIncompleteTasks).toBe("function")
  })

  test("todo helpers importable from new path", () => {
    //#given
    const todos = [{ status: "pending" }, { status: "completed" }]
    //#when
    const count = getIncompleteCount(todos)
    //#then
    expect(count).toBe(1)
    expect(typeof getIncompleteTasks).toBe("function")
    expect(typeof filterTasksBySession).toBe("function")
  })

  test("deprecated enforcer name still parses", () => {
    //#given
    const name = "task-continuation-enforcer"
    //#when
    const parsed = HookNameSchema.parse(name)
    //#then
    expect(parsed).toBe("task-continuation-enforcer")
  })
})
