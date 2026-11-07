/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createStopContinuationGuardHook } from "../../../src/hooks/stop-continuation-guard/hook"

function createMockCtx() {
  return {
    session: { context: async () => [] },
    directory: "/tmp/test",
  } as never
}

describe("stop-continuation-guard staleness (B14 RED)", () => {
  test("stale ghost stop entry (age >30s) no longer blocks — isStopped false", async () => {
    //#given a guard with an injectable clock and a stopped session
    let now = 1000
    const guard = createStopContinuationGuardHook(createMockCtx(), {
      nowMonotonic: () => now,
    })
    const sessionID = "stale-ghost-1"
    await guard.stop(sessionID)
    expect(guard.isStopped(sessionID)).toBe(true)

    //#when 31s pass (past the 30s staleness TTL)
    now += 31_000

    //#then the stale entry expires: stop is allowed through (no longer blocked)
    expect(guard.isStopped(sessionID)).toBe(false)
  })

  test("fresh busy session still blocks with reason + continuationHint", async () => {
    //#given a freshly stopped session that is truly busy
    let now = 5000
    const guard = createStopContinuationGuardHook(createMockCtx(), {
      nowMonotonic: () => now,
      isBusy: () => true,
    })
    const sessionID = "fresh-busy-1"
    await guard.stop(sessionID)

    //#when the guard is consulted while fresh and busy
    const verdict = guard.shouldBlock(sessionID)

    //#then it blocks with a reason and a continuation hint
    expect(verdict.blocked).toBe(true)
    expect(typeof verdict.reason).toBe("string")
    expect(verdict.reason!.length).toBeGreaterThan(0)
    expect(typeof verdict.continuationHint).toBe("string")
    expect(guard.isStopped(sessionID)).toBe(true)
  })

  test("stale entry consult returns allowed + stale-enforcer-state reason", async () => {
    //#given a stopped session with an injectable clock
    let now = 9000
    const guard = createStopContinuationGuardHook(createMockCtx(), {
      nowMonotonic: () => now,
      isBusy: () => true,
    })
    const sessionID = "stale-consult-1"
    await guard.stop(sessionID)

    //#when the entry goes stale and is consulted
    now += 60_000
    const verdict = guard.shouldBlock(sessionID)

    //#then stale allows through with the stale-enforcer-state reason
    expect(verdict.blocked).toBe(false)
    expect(verdict.reason).toContain("stale-enforcer-state")
    expect(guard.isStopped(sessionID)).toBe(false)
  })
})
