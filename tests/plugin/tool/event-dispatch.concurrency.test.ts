/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import type { V2Event } from "../../../src/plugin/tool/context"
import { createEventDispatcher } from "../../../src/plugin/tool/event-dispatch"

const EXPECTED_MAX_IN_FLIGHT_SESSIONS = 8
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, limit = 600): Promise<boolean> {
  for (let attempt = 0; attempt < limit && !condition(); attempt += 1) {
    await sleep(2)
  }
  return condition()
}

/** One-shot subscription that stays open until the signal aborts, so the pump
 * never resubscribes and re-delivers the same fixture. */
function subscribeOf(events: V2Event[]) {
  return async function* subscribe(options: { signal: AbortSignal }): AsyncIterable<V2Event> {
    for (const event of events) yield event
    while (!options.signal.aborted) await sleep(2)
  }
}

describe("createEventDispatcher event pump", () => {
  it("a slow session does not block a fast session", async () => {
    //#given - two sessions whose handlers differ by two orders of magnitude
    const completions: string[] = []
    const dispatcher = createEventDispatcher({
      handler: async (event) => {
        const data = event.data as { label: string; delay: number }
        await sleep(data.delay)
        completions.push(data.label)
      },
      guard: async (_label, fn) => fn(),
    })
    const events: V2Event[] = [
      { type: "session.idle", data: { sessionID: "ses_slow", label: "A", delay: 200 } },
      { type: "session.idle", data: { sessionID: "ses_fast", label: "B", delay: 1 } },
    ]

    //#when - both sessions are queued back to back on the pump
    const controller = new AbortController()
    dispatcher.start(subscribeOf(events), controller.signal)
    const settled = await waitFor(() => completions.length === 2)
    controller.abort()
    dispatcher.stop()

    //#then - the fast session finishes first even though its event arrived second
    expect(settled).toBe(true)
    expect(completions).toEqual(["B", "A"])
  })

  it("keeps same-session events strictly in order", async () => {
    //#given - two events for one session, the first far slower than the second
    const completions: string[] = []
    const dispatcher = createEventDispatcher({
      handler: async (event) => {
        const data = event.data as { label: string; delay: number }
        await sleep(data.delay)
        completions.push(data.label)
      },
      guard: async (_label, fn) => fn(),
    })
    const events: V2Event[] = [
      { type: "session.idle", data: { sessionID: "ses_a", label: "A1", delay: 50 } },
      { type: "session.idle", data: { sessionID: "ses_a", label: "A2", delay: 1 } },
    ]

    //#when - both events enter the pump for the same session
    const controller = new AbortController()
    dispatcher.start(subscribeOf(events), controller.signal)
    const settled = await waitFor(() => completions.length === 2)
    controller.abort()
    dispatcher.stop()

    //#then - the slow first event still completes before the fast second one
    expect(settled).toBe(true)
    expect(completions).toEqual(["A1", "A2"])
  })

  it("caps concurrency at the in-flight session limit", async () => {
    //#given - a burst of independent sessions, each with a measurable body
    let active = 0
    let peakActive = 0
    let completed = 0
    const dispatcher = createEventDispatcher({
      handler: async () => {
        active += 1
        peakActive = Math.max(peakActive, active)
        await sleep(20)
        active -= 1
        completed += 1
      },
      guard: async (_label, fn) => fn(),
    })
    const events: V2Event[] = Array.from({ length: 12 }, (_unused, index) => ({
      type: "session.idle",
      data: { sessionID: `ses_burst_${index}` },
    }))

    //#when - the whole burst is queued at once
    const controller = new AbortController()
    dispatcher.start(subscribeOf(events), controller.signal)
    const settled = await waitFor(() => completed === events.length)
    controller.abort()
    dispatcher.stop()

    //#then - sessions overlap, but never past the cap
    expect(settled).toBe(true)
    expect(peakActive).toBeGreaterThan(1)
    expect(peakActive).toBeLessThanOrEqual(EXPECTED_MAX_IN_FLIGHT_SESSIONS)
  })

  it("logs handler rejections with the session key", async () => {
    //#given - a handler that always fails for one session
    const logs: Array<{ message: string; data?: unknown }> = []
    const dispatcher = createEventDispatcher({
      handler: async () => {
        throw new Error("boom")
      },
      guard: async (_label, fn) => fn(),
      log: (message, data) => {
        logs.push({ message, data })
      },
    })

    //#when - the failing event is dispatched
    await dispatcher.dispatchMatrixxEvent({ type: "session.idle", data: { sessionID: "ses_boom" } })

    //#then - the failure is logged, never swallowed, and names the session
    const entry = logs.find((item) => item.message === "[matrixx] event dispatch error")
    expect(entry).toBeDefined()
    expect((entry?.data as Record<string, unknown>).session).toBe("ses_boom")
  })
})
