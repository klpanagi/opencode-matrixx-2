import { describe, expect, test } from "bun:test"
import { createEventPump } from "../../src/plugin/event-pump"

type Logged = { message: string; data?: unknown }

function makeRecorder(): { records: Logged[]; log: (message: string, data?: unknown) => void } {
  const records: Logged[] = []
  const log = (message: string, data?: unknown): void => {
    records.push({ message, data })
  }
  return { records, log }
}

type FakeEvent = { type: string; properties: Record<string, unknown> }

function toV1Event(e: unknown): { event: { type: string; properties: Record<string, unknown> } } {
  const event = e as FakeEvent
  return { event: { type: event.type, properties: event.properties } }
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await Bun.sleep(10)
  }
  expect(condition()).toBe(true)
}

describe("event-pump probe", () => {
  test("logs subscribe then first event", async () => {
    //#given
    const { records, log } = makeRecorder()
    const delivered: Array<{ type: string }> = []
    const controller = new AbortController()
    const pump = createEventPump({
      subscribe: () =>
        (async function* () {
          yield { type: "session.idle", properties: { sessionID: "s1" } }
        })(),
      handler: async (e) => {
        delivered.push({ type: e.event.type })
      },
      signal: controller.signal,
      guard: async <T>(_label: string, fn: () => Promise<T>): Promise<T | undefined> => fn(),
      log,
      toV1Event,
    })
    //#when
    pump.start()
    await waitFor(() => delivered.length === 1, "first event delivered")
    pump.stop()
    //#then
    const subscribed = records.filter((r) => r.message === "[matrixx] event pump subscribed")
    const first = records.filter((r) => r.message === "[matrixx] event pump first event")
    expect(subscribed).toHaveLength(1)
    expect(first).toHaveLength(1)
    expect((first[0]?.data as { type?: string } | undefined)?.type).toBe("session.idle")
    expect(pump.stats().attempts).toBe(1)
  })

  test("delivers every event to the handler", async () => {
    //#given
    const { log } = makeRecorder()
    const delivered: Array<{ type: string; properties: Record<string, unknown> }> = []
    const controller = new AbortController()
    const pump = createEventPump({
      subscribe: () =>
        (async function* () {
          yield { type: "session.idle", properties: { sessionID: "s1" } }
          yield { type: "message.updated", properties: { sessionID: "s1" } }
          yield { type: "session.idle", properties: { sessionID: "s2" } }
        })(),
      handler: async (e) => {
        delivered.push({ type: e.event.type, properties: e.event.properties })
      },
      signal: controller.signal,
      guard: async <T>(_label: string, fn: () => Promise<T>): Promise<T | undefined> => fn(),
      log,
      toV1Event,
    })
    //#when
    pump.start()
    await waitFor(() => delivered.length === 3, "all events delivered")
    pump.stop()
    //#then
    expect(delivered).toHaveLength(3)
    expect(delivered[0]).toEqual({ type: "session.idle", properties: { sessionID: "s1" } })
    expect(pump.stats().delivered).toBe(3)
  })

  test("abort ends the pump without an error log", async () => {
    //#given
    const { records, log } = makeRecorder()
    const controller = new AbortController()
    let subscribes = 0
    const pump = createEventPump({
      subscribe: (o: { signal: AbortSignal }) =>
        (async function* () {
          subscribes += 1
          if (o.signal.aborted) return
          yield { type: "session.idle", properties: { sessionID: "s1" } }
        })(),
      handler: async () => {},
      signal: controller.signal,
      guard: async <T>(_label: string, fn: () => Promise<T>): Promise<T | undefined> => fn(),
      log,
      toV1Event,
    })
    //#when
    controller.abort()
    pump.start()
    await Bun.sleep(50)
    pump.stop()
    //#then
    expect(subscribes).toBe(1)
    expect(records.filter((r) => r.message === "[matrixx] event stream ended")).toHaveLength(0)
    expect(pump.stats().dead).toBe(false)
  })
})
