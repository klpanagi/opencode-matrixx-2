/// <reference types="bun-types" />
import { describe, test, expect, afterEach } from "bun:test"
import { KNOWN_SESSIONS_MAX } from "../../../src/features/background-agent/constants"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

describe("bounded known sessions", () => {
  let runtime: ManagerRuntimeFixture | undefined

  afterEach(() => {
    runtime?.dispose()
    runtime = undefined
  })

  test("caps repeated inserts at KNOWN_SESSIONS_MAX", () => {
    //#given
    runtime = createManagerRuntime()
    const ids = Array.from({ length: 1000 }, (_, index) => `ses_known_${index}`)

    //#when
    for (const id of ids) runtime.store.rememberKnownSession(id)

    //#then
    expect(runtime.store.getKnownSessionIds().size).toBe(KNOWN_SESSIONS_MAX)
  })

  test("evicts the oldest sessions first and keeps the newest window", () => {
    //#given
    runtime = createManagerRuntime()
    const ids = Array.from({ length: 1000 }, (_, index) => `ses_known_${index}`)

    //#when
    for (const id of ids) runtime.store.rememberKnownSession(id)
    const known = runtime.store.getKnownSessionIds()

    //#then
    expect(known.has(ids[0])).toBe(false)
    const newest = ids.slice(ids.length - KNOWN_SESSIONS_MAX)
    for (const id of newest) expect(known.has(id)).toBe(true)
  })

  test("re-inserting an existing session keeps the size at the bound", () => {
    //#given
    runtime = createManagerRuntime()
    const ids = Array.from({ length: KNOWN_SESSIONS_MAX }, (_, index) => `ses_known_${index}`)
    for (const id of ids) runtime.store.rememberKnownSession(id)

    //#when
    runtime.store.rememberKnownSession(ids[0])
    runtime.store.rememberKnownSession(ids[0])

    //#then
    expect(runtime.store.getKnownSessionIds().size).toBe(KNOWN_SESSIONS_MAX)
    expect(runtime.store.getKnownSessionIds().has(ids[0])).toBe(true)
  })
})
