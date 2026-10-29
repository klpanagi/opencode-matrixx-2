import { describe, expect, test } from "bun:test"
import {
  createEventPump,
  defaultSleep,
  pumpBackoffMs,
  stableStringify,
  type EventPumpDeps,
} from "../../src/plugin/event-pump"

type V2Like = { type: string } & Record<string, unknown>

function makeRecorder(): {
  records: Array<{ message: string; data?: unknown }>
  log: (message: string, data?: unknown) => void
} {
  const records: Array<{ message: string; data?: unknown }> = []
  return {
    records,
    log: (message: string, data?: unknown) => {
      records.push({ message, data })
    },
  }
}

function baseDeps(
  overrides: Partial<EventPumpDeps> = {},
  controller = new AbortController(),
): { deps: EventPumpDeps; controller: AbortController; records: Array<{ message: string; data?: unknown }> } {
  const rec = makeRecorder()
  const deps: EventPumpDeps = {
    subscribe: () => (async function* (): AsyncGenerator<V2Like> {})(),
    handler: async () => {},
    signal: controller.signal,
    guard: async <T>(_label: string, fn: () => Promise<T>): Promise<T | undefined> => fn(),
    log: rec.log,
    toV1Event: (e: unknown) => ({ event: e as { type: string; properties: Record<string, unknown> } }),
    sleep: async () => {},
    ...overrides,
  }
  return { deps, controller, records: rec.records }
}

function idleEvent(sessionID: string): V2Like {
  return { type: "session.idle", properties: { sessionID } }
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await Bun.sleep(5)
  }
}

describe("event pump resilience", () => {
  test("resubscribes after a decode error", async () => {
    //#given
    let subscribes = 0
    const handlerCalls: unknown[] = []
    const { deps, records } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          subscribes += 1
          if (subscribes === 1) {
            yield idleEvent("s1")
            throw new Error("decode")
          } else {
            yield idleEvent("s2")
          }
        })(),
      handler: async (e) => {
        handlerCalls.push(e)
      },
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => handlerCalls.length === 2)
    pump.stop()
    //#then
    expect(subscribes).toBe(2)
    expect(handlerCalls.length).toBe(2)
    const messages = records.map((r) => r.message)
    const endedAt = messages.indexOf("[matrixx] event stream ended")
    const resubAt = messages.indexOf("[matrixx] event pump resubscribe")
    expect(endedAt).toBeGreaterThanOrEqual(0)
    expect(resubAt).toBeGreaterThan(endedAt)
    const data = records[resubAt].data as { attempt: number; backoffMs: number }
    expect(data.attempt).toBe(2)
    expect(data.backoffMs).toBe(250)
  })

  test("backs off exponentially and caps", async () => {
    //#given
    let subscribes = 0
    const { deps, records } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          subscribes += 1
          if (subscribes <= 3) throw new Error("boom")
        })(),
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => subscribes === 4)
    pump.stop()
    //#then
    const backoffs = records
      .filter((r) => r.message === "[matrixx] event pump resubscribe")
      .map((r) => (r.data as { backoffMs: number }).backoffMs)
    expect(backoffs).toEqual([250, 500, 1000])
    expect(pumpBackoffMs(30)).toBe(30_000)
  })

  test("resets the failure counter after a successful event", async () => {
    //#given
    let subscribes = 0
    const handlerCalls: unknown[] = []
    const { deps } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          subscribes += 1
          if (subscribes === 1) throw new Error("t1")
          if (subscribes === 2) {
            yield idleEvent("r1")
            throw new Error("t2")
          }
          if (subscribes === 3) {
            yield idleEvent("r2")
          }
        })(),
      handler: async (e) => {
        handlerCalls.push(e)
      },
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => handlerCalls.length === 2)
    pump.stop()
    //#then
    expect(pump.stats().dead).toBe(false)
    expect(pump.stats().consecutiveFailures).toBe(0)
  })

  test("dies after the cap", async () => {
    //#given
    let subscribes = 0
    const { deps, records } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          subscribes += 1
          throw new Error("dead-transport")
        })(),
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => pump.stats().dead)
    pump.stop()
    await Bun.sleep(50)
    //#then
    expect(subscribes).toBe(5)
    expect(pump.stats().dead).toBe(true)
    expect(pump.stats().attempts).toBe(5)
    const deadRecords = records.filter((r) => r.message === "[matrixx] event pump dead")
    expect(deadRecords.length).toBe(1)
    expect((deadRecords[0].data as { attempts: number }).attempts).toBe(5)
  })

  test("stop() after the death cap performs no further subscribe", async () => {
    //#given
    let subscribes = 0
    const { deps, records } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          subscribes += 1
          throw new Error("dead-transport")
        })(),
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => pump.stats().dead)
    pump.stop()
    await Bun.sleep(50)
    //#then
    expect(subscribes).toBe(5)
    expect(pump.stats().dead).toBe(true)
    expect(pump.stats().attempts).toBe(5)
    expect(records.filter((r) => r.message === "[matrixx] event pump dead").length).toBe(1)
  })

  test("abort during backoff stops immediately", async () => {
    //#given
    const controller = new AbortController()
    let subscribes = 0
    const { deps, records } = baseDeps(
      {
        subscribe: () =>
          (async function* (): AsyncGenerator<V2Like> {
            subscribes += 1
            throw new Error("decode")
          })(),
        sleep: async () => {
          controller.abort()
        },
      },
      controller,
    )
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => controller.signal.aborted)
    await Bun.sleep(20)
    pump.stop()
    //#then
    expect(subscribes).toBe(1)
    expect(records.some((r) => r.message === "[matrixx] event pump resubscribe")).toBe(false)
    expect(records.some((r) => r.message === "[matrixx] event pump dead")).toBe(false)
    expect(pump.stats().dead).toBe(false)
  })

  test("drops a replayed duplicate inside the window", async () => {
    //#given
    let now = 1000
    const handlerCalls: unknown[] = []
    const { deps } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          yield idleEvent("dup")
          now += 100
          yield idleEvent("dup")
          now += 500
          yield idleEvent("dup")
        })(),
      handler: async (e) => {
        handlerCalls.push(e)
      },
      now: () => now,
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => handlerCalls.length === 2)
    pump.stop()
    //#then
    expect(handlerCalls.length).toBe(2)
  })

  test("does not drop identical non-idle events in the same window", async () => {
    //#given
    const handlerCalls: unknown[] = []
    const payload = { type: "message.updated", properties: { sessionID: "m1" } }
    const { deps } = baseDeps({
      subscribe: () =>
        (async function* (): AsyncGenerator<V2Like> {
          yield { ...payload }
          yield { ...payload }
        })(),
      handler: async (e) => {
        handlerCalls.push(e)
      },
      now: () => 1000,
    })
    //#when
    const pump = createEventPump(deps)
    pump.start()
    await waitFor(() => handlerCalls.length === 2)
    pump.stop()
    //#then
    expect(handlerCalls.length).toBe(2)
    expect(pump.stats().delivered).toBe(2)
  })

  test("stableStringify is key-order independent", async () => {
    //#given
    const a = { a: 1, b: 2 }
    const b = { b: 2, a: 1 }
    //#when
    const sa = stableStringify(a)
    const sb = stableStringify(b)
    //#then
    expect(sa).toBe(sb)
    expect(stableStringify({ outer: { z: 1, a: [3, 2] }, m: 0 })).toBe(
      stableStringify({ m: 0, outer: { a: [3, 2], z: 1 } }),
    )
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
    expect(JSON.parse(sa)).toEqual({ a: 1, b: 2 })
  })

  test("the default sleep removes its abort listener", async () => {
    //#given
    const listeners = new Set<() => void>()
    const fakeSignal = {
      aborted: false,
      addEventListener: (_type: string, fn: () => void) => {
        listeners.add(fn)
      },
      removeEventListener: (_type: string, fn: () => void) => {
        listeners.delete(fn)
      },
    }
    //#when
    await defaultSleep(0, fakeSignal as unknown as AbortSignal)
    //#then
    expect(listeners.size).toBe(0)
  })

  test("the default sleep resolves early on abort", async () => {
    //#given
    const controller = new AbortController()
    const start = Date.now()
    //#when
    const pending = defaultSleep(10_000, controller.signal)
    setTimeout(() => controller.abort(), 5)
    await pending
    //#then
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
