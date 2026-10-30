import { describe, expect, it } from "bun:test"
import { createEventDispatcher } from "../../src/plugin/event-dispatch"
import type { V2Event } from "../../src/plugin/context"

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 2))

async function waitFor(condition: () => boolean, limit = 200): Promise<boolean> {
  for (let attempt = 0; attempt < limit && !condition(); attempt += 1) {
    await tick()
  }
  return condition()
}

describe("createEventDispatcher", () => {
  it("dispatches each event to the handler behind one guard label", async () => {
    //#given - a dispatcher with a recording handler and label-capturing guard
    const seen: string[] = []
    const labels: string[] = []
    const dispatcher = createEventDispatcher({
      handler: async (event) => {
        seen.push(event.type)
      },
      guard: async (label, fn) => {
        labels.push(label)
        return fn()
      },
    })
    //#when - one flat V2 event is dispatched
    await dispatcher.dispatchMatrixxEvent({ type: "session.idle", data: { sessionID: "ses_1" } })
    //#then - the handler saw it behind the per-type guard label
    expect(seen).toEqual(["session.idle"])
    expect(labels).toEqual(["event:session.idle"])
  })

  it("a throwing handler does not stop the loop", async () => {
    //#given - a handler that throws on the first of three events
    const received: string[] = []
    const dispatcher = createEventDispatcher({
      handler: async (event) => {
        received.push(event.type)
        if (event.type === "boom") throw new Error("boom")
      },
      guard: async (_label, fn) => fn(),
    })
    const events: V2Event[] = [{ type: "boom" }, { type: "a" }, { type: "b" }]
    async function* subscribe(): AsyncIterable<V2Event> {
      for (const event of events) yield event
    }
    //#when - the subscription runs to completion
    const controller = new AbortController()
    dispatcher.start(subscribe, controller.signal)
    const settled = await waitFor(() => dispatcher.stats().delivered >= 2)
    controller.abort()
    dispatcher.stop()
    //#then - all three reached the handler even though the first threw
    expect(settled).toBe(true)
    expect(received).toEqual(["boom", "a", "b"])
  })

  it("an iteration error resubscribes with bounded backoff instead of dying", async () => {
    //#given - a subscribe that fails once, then serves one event
    const sleeps: number[] = []
    const dispatcher = createEventDispatcher({
      handler: async () => {},
      guard: async (_label, fn) => fn(),
      sleep: async (ms) => {
        sleeps.push(ms)
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
      },
    })
    let calls = 0
    function subscribe(): AsyncIterable<V2Event> {
      calls += 1
      if (calls === 1) throw new Error("stream ended")
      return (async function* () {
        yield { type: "session.idle", data: {} }
      })()
    }
    //#when - the loop runs past the first failure
    const controller = new AbortController()
    dispatcher.start(subscribe, controller.signal)
    const settled = await waitFor(() => dispatcher.stats().delivered >= 1)
    controller.abort()
    dispatcher.stop()
    //#then - it resubscribed (attempt 2) after one bounded backoff, with no death flag
    expect(settled).toBe(true)
    expect(dispatcher.stats().attempts).toBeGreaterThanOrEqual(2)
    expect(sleeps.length).toBeGreaterThanOrEqual(1)
    expect(sleeps[0]).toBe(250)
    expect("dead" in dispatcher.stats()).toBe(false)
  })

  it("disposal aborts the subscription", async () => {
    //#given - a running dispatcher over an infinite stream
    let observedAbort = false
    const dispatcher = createEventDispatcher({
      handler: async () => {},
      guard: async (_label, fn) => fn(),
    })
    async function* subscribe(options: { signal: AbortSignal }): AsyncIterable<V2Event> {
      try {
        for (;;) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1))
          yield { type: "tick" }
        }
      } finally {
        observedAbort = options.signal.aborted
      }
    }
    //#when - the controller aborts and the dispatcher stops
    const controller = new AbortController()
    dispatcher.start(subscribe, controller.signal)
    await waitFor(() => dispatcher.stats().delivered >= 1)
    controller.abort()
    dispatcher.stop()
    //#then - the generator observed the abort
    const settled = await waitFor(() => observedAbort, 500)
    expect(settled).toBe(true)
  })
})
