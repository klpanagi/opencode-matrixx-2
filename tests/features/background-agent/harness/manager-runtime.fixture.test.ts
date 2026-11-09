/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync } from "node:fs"
import type { ManagerRuntime } from "../../../../src/features/background-agent/manager/types"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
} from "./manager-runtime.fixture"
import { createFakeClock } from "./fake-clock"

describe("createManagerRuntime", () => {
  let runtime: ManagerRuntimeFixture

  beforeEach(() => {
    runtime = createManagerRuntime()
  })

  afterEach(() => {
    runtime.dispose()
  })

  test("returns an object satisfying ManagerRuntime", () => {
    //#given
    const asRuntime: ManagerRuntime = runtime

    //#when
    const fields = {
      store: asRuntime.store,
      native: asRuntime.native,
      directory: asRuntime.directory,
      taskHistory: asRuntime.taskHistory,
    }

    //#then
    expect(fields.store).toBeDefined()
    expect(fields.native).toBeDefined()
    expect(fields.directory).toBe(runtime.directory)
    expect(fields.taskHistory).toBeDefined()
  })

  test("wires now() to the fake clock", () => {
    //#given
    expect(runtime.now?.()).toBe(0)

    //#when
    runtime.clock.advance(500)

    //#then
    expect(runtime.now?.()).toBe(500)
  })

  test("wires timers to the fake clock and fires on advance", () => {
    //#given
    const fired: string[] = []
    runtime.timers?.setTimeout(() => fired.push("timer"), 100)

    //#when
    runtime.clock.advance(99)
    const before = [...fired]
    runtime.clock.advance(1)

    //#then
    expect(before).toEqual([])
    expect(fired).toEqual(["timer"])
  })

  test("dispose removes the temp directory", () => {
    //#given
    const directory = runtime.directory
    expect(existsSync(directory)).toBe(true)

    //#when
    runtime.dispose()

    //#then
    expect(existsSync(directory)).toBe(false)
  })
})

describe("recordNotifications", () => {
  let runtime: ManagerRuntimeFixture

  beforeEach(() => {
    runtime = createManagerRuntime()
  })

  afterEach(() => {
    runtime.dispose()
  })

  test("captures payloads passed to runtime.notify", async () => {
    //#given
    const recorder = recordNotifications(runtime)

    //#when
    await runtime.notify?.({ id: "bg_1", kind: "completed" })
    await runtime.notify?.({ id: "bg_2", kind: "failed" })

    //#then
    expect(recorder.calls).toEqual([
      { id: "bg_1", kind: "completed" },
      { id: "bg_2", kind: "failed" },
    ])
  })

  test("dispose restores the previous notify handler", async () => {
    //#given
    const seen: unknown[] = []
    runtime.notify = (payload) => {
      seen.push(payload)
    }
    const recorder = recordNotifications(runtime)

    //#when
    recorder.dispose()
    await runtime.notify?.({ id: "bg_3" })

    //#then
    expect(recorder.calls).toEqual([])
    expect(seen).toEqual([{ id: "bg_3" }])
  })
})

describe("createFakeClock", () => {
  test("tracks pending timers and fires them in time order", () => {
    //#given
    const clock = createFakeClock()
    const order: string[] = []
    clock.setTimeout(() => order.push("second"), 200)
    clock.setTimeout(() => order.push("first"), 100)

    //#when
    const pendingBefore = clock.pendingCount
    clock.advance(200)

    //#then
    expect(pendingBefore).toBe(2)
    expect(order).toEqual(["first", "second"])
    expect(clock.pendingCount).toBe(0)
  })

  test("clearTimeout prevents a pending callback", () => {
    //#given
    const clock = createFakeClock()
    let fired = false
    const handle = clock.setTimeout(() => {
      fired = true
    }, 50)

    //#when
    clock.clearTimeout(handle)
    clock.advance(100)

    //#then
    expect(fired).toBe(false)
    expect(clock.pendingCount).toBe(0)
  })
})
