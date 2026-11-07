/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import {
  DeadlineExceededError,
  isDeadlineExceeded,
  stopWithDeadline,
} from "../../../src/hooks/stop-continuation-guard/stop-deadline"

describe("stopWithDeadline", () => {
  test("hung task ignores cancel → forced within deadline, abandonment logged", async () => {
    //#given a task that never settles after graceful cancel
    let now = 1000
    const sleepCalls: number[] = []
    const disarmed: string[] = []
    const logs: Array<{ message: string; data?: unknown }> = []
    const sleep = async (ms: number): Promise<void> => {
      sleepCalls.push(ms)
      now += ms
    }

    //#when the guard runs with a 500ms deadline
    const outcome = await stopWithDeadline(
      "ses_hung",
      {
        cancel: () => ["bg_hung"],
        pendingIds: () => ["bg_hung"],
        disarm: (taskId: string) => {
          disarmed.push(taskId)
        },
        now: () => now,
        sleep,
        log: (message: string, data?: unknown) => {
          logs.push({ message, data })
        },
      },
      { deadlineMs: 500, pollIntervalMs: 100 },
    ).then(
      () => {
        throw new Error("expected DeadlineExceededError")
      },
      (error: unknown) => error,
    )

    //#then a typed DeadlineExceededError names the abandoned task
    expect(outcome).toBeInstanceOf(DeadlineExceededError)
    expect(isDeadlineExceeded(outcome)).toBe(true)
    const err = outcome as DeadlineExceededError
    expect(err.code).toBe("DeadlineExceeded")
    expect(err.taskIds).toEqual(["bg_hung"])
    //#then the leftover timer was disarmed (Task 3 wiring driven)
    expect(disarmed).toEqual(["bg_hung"])
    //#then abandonment was logged with what was abandoned
    const forceLog = logs.find((entry) => entry.message.includes("forcing"))
    expect(forceLog).toBeDefined()
    expect(JSON.stringify(forceLog?.data)).toContain("bg_hung")
    //#then bounded duration: elapsed never exceeded the deadline + one poll
    expect(now - 1000).toBeLessThanOrEqual(500 + 100)
    expect(sleepCalls.length).toBeGreaterThan(0)
  })

  test("cooperative task settles → graceful, no force log, no disarm", async () => {
    //#given a task that settles right after graceful cancel
    let now = 2000
    let calls = 0
    const disarmed: string[] = []
    const logs: Array<{ message: string; data?: unknown }> = []

    //#when the guard runs
    const result = await stopWithDeadline(
      "ses_clean",
      {
        cancel: () => ["bg_clean"],
        pendingIds: () => {
          calls += 1
          return calls <= 1 ? ["bg_clean"] : []
        },
        disarm: (taskId: string) => {
          disarmed.push(taskId)
        },
        now: () => now,
        sleep: async (ms: number) => {
          now += ms
        },
        log: (message: string, data?: unknown) => {
          logs.push({ message, data })
        },
      },
      { deadlineMs: 500, pollIntervalMs: 100 },
    )

    //#then graceful: not forced, no abandoned tasks
    expect(result.forced).toBe(false)
    expect(result.abandoned).toEqual([])
    //#then no force branch hit: no disarm, no forcing log
    expect(disarmed).toEqual([])
    expect(logs.some((entry) => entry.message.includes("forcing"))).toBe(false)
  })

  test("already-settled session → cancel driven, resolves immediately", async () => {
    //#given no pending tasks at entry
    let slept = 0
    let cancelCalls = 0

    //#when the guard runs
    const result = await stopWithDeadline("ses_idle", {
      cancel: () => {
        cancelCalls += 1
        return []
      },
      pendingIds: () => [],
      disarm: () => {},
      sleep: async () => {
        slept += 1
      },
    })

    //#then cancel wiring was still driven once, no waiting, no force
    expect(cancelCalls).toBe(1)
    expect(slept).toBe(0)
    expect(result.forced).toBe(false)
  })
})
