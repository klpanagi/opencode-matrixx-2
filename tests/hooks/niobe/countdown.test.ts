import { describe, expect, test } from "bun:test"
import {
  CONTINUATION_COOLDOWN_MS,
  _resetSessionLocksForTesting,
  runWithSessionLock,
  tryClaimContinuationSlot,
} from "../../../src/hooks/niobe/event-handler"
import type { SessionState } from "../../../src/hooks/niobe/types"

function buildState(): SessionState {
  return { promptFailureCount: 0 }
}

describe("B12 atomic countdown (session.idle continuation slot)", () => {
  test("cooldown value is preserved at 5000ms", () => {
    //#given
    const expected = 5000

    //#when
    const actual = CONTINUATION_COOLDOWN_MS

    //#then
    expect(actual).toBe(expected)
  })

  test("first claim wins, repeat within cooldown is rejected", () => {
    //#given
    const state = buildState()
    const now = 1_000_000

    //#when
    const first = tryClaimContinuationSlot(state, now)
    const second = tryClaimContinuationSlot(state, now + 1000)

    //#then
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(state.lastContinuationInjectedAt).toBe(now)
  })

  test("stale timestamp never overwrites a newer timestamp", () => {
    //#given
    const state = buildState()
    tryClaimContinuationSlot(state, 1_000_000)

    //#when
    const staleWins = tryClaimContinuationSlot(state, 999_000, 0)

    //#then
    expect(staleWins).toBe(false)
    expect(state.lastContinuationInjectedAt).toBe(1_000_000)
  })

  test("newer timestamp wins once cooldown elapsed (timestamp-ordered last-write-wins)", () => {
    //#given
    const state = buildState()
    tryClaimContinuationSlot(state, 1_000_000)

    //#when
    const newerWins = tryClaimContinuationSlot(state, 1_000_000 + CONTINUATION_COOLDOWN_MS + 1)

    //#then
    expect(newerWins).toBe(true)
    expect(state.lastContinuationInjectedAt).toBe(1_000_000 + CONTINUATION_COOLDOWN_MS + 1)
  })

  test("100 concurrent claims on one session yield exactly one winner (zero lost updates)", async () => {
    //#given
    _resetSessionLocksForTesting()
    const state = buildState()
    const now = 2_000_000

    //#when
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        runWithSessionLock("sess-race", async () => tryClaimContinuationSlot(state, now)),
      ),
    )

    //#then
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(state.lastContinuationInjectedAt).toBe(now)
  })

  test("concurrent claims on different sessions do not block each other", async () => {
    //#given
    _resetSessionLocksForTesting()
    const states = new Map<string, SessionState>()
    const getState = (id: string): SessionState => {
      let s = states.get(id)
      if (!s) {
        s = buildState()
        states.set(id, s)
      }
      return s
    }
    const now = 3_000_000

    //#when
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        runWithSessionLock(`sess-${i}`, async () => tryClaimContinuationSlot(getState(`sess-${i}`), now)),
      ),
    )

    //#then
    expect(results.filter(Boolean)).toHaveLength(50)
  })

  test("lock releases after failure so later claims can proceed", async () => {
    //#given
    _resetSessionLocksForTesting()
    const state = buildState()

    //#when
    await expect(
      runWithSessionLock("sess-fail", async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    const after = await runWithSessionLock("sess-fail", async () => tryClaimContinuationSlot(state, 4_000_000))

    //#then
    expect(after).toBe(true)
    expect(state.lastContinuationInjectedAt).toBe(4_000_000)
  })
})
