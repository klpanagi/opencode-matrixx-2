/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import {
  CONTINUATION_COOLDOWN_MS,
  _resetSessionLocksForTesting,
  getMonotonicNow,
  isContinuationValid,
  runWithSessionLock,
  tryClaimContinuationSlot,
} from "../../../src/hooks/niobe/event-handler"
import { isLoopStateStillValid } from "../../../src/hooks/matrix-loop/matrix-loop-event-handler"
import type { SessionState } from "../../../src/hooks/niobe/types"

function buildState(): SessionState {
  return { promptFailureCount: 0 }
}

describe("B13 inFlight/idle TOCTOU + cooldown bypass", () => {
  test("cooldown value preserved at 5000ms (B12 contract)", async () => {
    //#given
    const expected = 5000

    //#when
    const actual = CONTINUATION_COOLDOWN_MS

    //#then
    expect(actual).toBe(expected)
  })

  test("monotonic clock does not go backwards across calls", async () => {
    //#given
    const t0 = getMonotonicNow()

    //#when
    const t1 = getMonotonicNow()

    //#then
    expect(t1).toBeGreaterThanOrEqual(t0)
  })

  test("concurrent idle race: 100 racers, exactly one cooldown claim wins", async () => {
    //#given
    _resetSessionLocksForTesting()
    const state = buildState()
    const now = getMonotonicNow()

    //#when
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        runWithSessionLock("sess-b13-race", async () => tryClaimContinuationSlot(state, now)),
      ),
    )

    //#then
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test("cooldown bypass closed: claim inside lock then immediate re-claim rejected", async () => {
    //#given
    _resetSessionLocksForTesting()
    const state = buildState()
    const now = getMonotonicNow()
    const first = await runWithSessionLock("sess-b13-bypass", async () =>
      tryClaimContinuationSlot(state, now),
    )

    //#when
    const second = await runWithSessionLock("sess-b13-bypass", async () =>
      tryClaimContinuationSlot(state, now + 10),
    )

    //#then
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  test("re-validation rejects stale snapshot: stopped session must not inject", async () => {
    //#given
    const staleGates = {
      hasMission: true,
      missionComplete: false,
      isContinuationStopped: true,
      abortBeforeIdle: false,
      bgRunning: false,
      promptFailuresExceeded: false,
    }

    //#when
    const valid = isContinuationValid(staleGates)

    //#then
    expect(valid).toBe(false)
  })

  test("re-validation rejects completed mission snapshot", async () => {
    //#given
    const staleGates = {
      hasMission: true,
      missionComplete: true,
      isContinuationStopped: false,
      abortBeforeIdle: false,
      bgRunning: false,
      promptFailuresExceeded: false,
    }

    //#when
    const valid = isContinuationValid(staleGates)

    //#then
    expect(valid).toBe(false)
  })

  test("re-validation accepts fresh snapshot", async () => {
    //#given
    const freshGates = {
      hasMission: true,
      missionComplete: false,
      isContinuationStopped: false,
      abortBeforeIdle: false,
      bgRunning: false,
      promptFailuresExceeded: false,
    }

    //#when
    const valid = isContinuationValid(freshGates)

    //#then
    expect(valid).toBe(true)
  })

  test("matrix-loop re-validation: cleared state after await must not act", async () => {
    //#given
    const entry = { active: true, iteration: 1, max_iterations: 5, completion_promise: "done", started_at: "", prompt: "" }
    const cleared = null

    //#when
    const valid = isLoopStateStillValid(entry, cleared, "ses-1")

    //#then
    expect(valid).toBe(false)
  })

  test("matrix-loop re-validation: session mismatch after await must not act", async () => {
    //#given
    const entry = { active: true, iteration: 1, max_iterations: 5, completion_promise: "done", started_at: "", prompt: "", session_id: "ses-1" }
    const current = { ...entry, iteration: 2 }

    //#when
    const valid = isLoopStateStillValid(entry, current, "ses-2")

    //#then
    expect(valid).toBe(false)
  })

  test("matrix-loop re-validation: unchanged active state stays valid", async () => {
    //#given
    const entry = { active: true, iteration: 1, max_iterations: 5, completion_promise: "done", started_at: "", prompt: "", session_id: "ses-1" }
    const current = { ...entry }

    //#when
    const valid = isLoopStateStillValid(entry, current, "ses-1")

    //#then
    expect(valid).toBe(true)
  })
})
