/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import { attributeTodoEffort } from "../../../src/hooks/plan-persister/effort-attribution"

describe("attributeTodoEffort", () => {
  test("explicit planTodo match keys correctly", async () => {
    //#given two checkboxes and a task with explicit planTodo
    const checkboxTexts = ["Implement login flow", "Add logout button"]
    const linkedTasks = [
      { taskId: "T-1", subject: "something unrelated entirely", total: 2, tokenUsd: 0.01, planTodo: "Add logout button" },
    ]

    //#when attributing effort
    const result = attributeTodoEffort({ checkboxTexts, linkedTasks })

    //#then effort lands on the explicit checkbox despite subject mismatch
    expect(result.perTodoActual["Add logout button"]?.total).toBe(2)
    expect(result.perTodoActual["Add logout button"]?.taskIds).toEqual(["T-1"])
    expect(result.unassigned).toEqual([])
  })

  test("overlap fallback assigns when no explicit planTodo", async () => {
    //#given a task subject overlapping one checkbox
    const checkboxTexts = ["Implement login flow", "Add logout button"]
    const linkedTasks = [
      { taskId: "T-1", subject: "Implement login flow", total: 3, tokenUsd: 0.02 },
    ]

    //#when attributing effort
    const result = attributeTodoEffort({ checkboxTexts, linkedTasks })

    //#then overlap assigns to the matching TODO
    expect(result.perTodoActual["Implement login flow"]?.total).toBe(3)
    expect(result.perTodoActual["Implement login flow"]?.tokenUsd).toBeCloseTo(0.02, 10)
    expect(result.unassigned).toEqual([])
  })

  test("ambiguous overlap goes to unassigned, never misattributed", async () => {
    //#given a generic subject matching two TODOs
    const checkboxTexts = ["Implement login flow", "Implement logout flow"]
    const linkedTasks = [
      { taskId: "T-9", subject: "Implement flow", total: 5, tokenUsd: 0.05 },
    ]

    //#when attributing effort
    const result = attributeTodoEffort({ checkboxTexts, linkedTasks })

    //#then nothing is attributed, task lands in unassigned
    expect(result.perTodoActual).toEqual({})
    expect(result.unassigned).toHaveLength(1)
    expect(result.unassigned[0]?.taskId).toBe("T-9")
  })

  test("unmatched subject goes to unassigned", async () => {
    //#given a task matching no checkbox
    const checkboxTexts = ["Implement login flow"]
    const linkedTasks = [
      { taskId: "T-2", subject: "Refactor billing pipeline", total: 1.5, tokenUsd: 0.03 },
    ]

    //#when attributing effort
    const result = attributeTodoEffort({ checkboxTexts, linkedTasks })

    //#then task lands in unassigned
    expect(result.perTodoActual).toEqual({})
    expect(result.unassigned).toHaveLength(1)
    expect(result.unassigned[0]?.total).toBe(1.5)
  })

  test("sums effort per TODO across tasks", async () => {
    //#given two tasks hitting the same TODO via explicit + overlap
    const checkboxTexts = ["Implement login flow", "Add logout button"]
    const linkedTasks = [
      { taskId: "T-1", subject: "Implement login flow", total: 2, tokenUsd: 0.01 },
      { taskId: "T-2", subject: "login flow follow-up", total: 4, tokenUsd: 0.03, planTodo: "Implement login flow" },
    ]

    //#when attributing effort
    const result = attributeTodoEffort({ checkboxTexts, linkedTasks })

    //#then totals sum and both task ids are recorded
    expect(result.perTodoActual["Implement login flow"]?.total).toBe(6)
    expect(result.perTodoActual["Implement login flow"]?.tokenUsd).toBeCloseTo(0.04, 10)
    expect(result.perTodoActual["Implement login flow"]?.taskIds.sort()).toEqual(["T-1", "T-2"])
    expect(result.unassigned).toEqual([])
  })
})
