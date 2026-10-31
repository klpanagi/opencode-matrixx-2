/// <reference types="bun-types" />
import { describe, test, expect, mock, beforeEach } from "bun:test"

const logCalls: Array<{ msg: string; data?: unknown }> = []

mock.module("../../../src/shared/logger", () => ({
  log: (msg: string, data?: unknown) => {
    logCalls.push({ msg, data })
  },
  warn: (_msg: string, _data?: unknown) => {},
}))

import { createBackgroundNotificationHook } from "../../../src/hooks/background-notification/hook"

function buildManager(task?: { id: string }) {
  return {
    handleEvent: mock(() => {}),
    findBySession: mock((_sessionID: string) => task),
  }
}

beforeEach(() => {
  logCalls.length = 0
})

describe("createBackgroundNotificationHook router logging", () => {
  test("hit path logs forward with event type and resolved task id", async () => {
    //#given
    const manager = buildManager({ id: "task-1" })
    const hook = createBackgroundNotificationHook(manager as never)
    const event = { type: "session.idle", data: { sessionID: "ses_abcdefgh123456" } }

    //#when
    await hook.event(event as never)

    //#then
    expect(manager.handleEvent).toHaveBeenCalledTimes(1)
    expect(manager.handleEvent).toHaveBeenCalledWith(event)
    expect(logCalls.length).toBeGreaterThan(0)
    const allText = logCalls.map((c) => `${c.msg} ${JSON.stringify(c.data)}`).join("\n")
    expect(allText).toContain("session.idle")
    expect(allText).toContain("task-1")
    expect(allText).toMatch(/forward/i)
  })

  test("miss path logs ignore with truncated sessionID comparison only", async () => {
    //#given
    const fullSessionID = "ses_abcdefgh1234567890"
    const manager = buildManager(undefined)
    const hook = createBackgroundNotificationHook(manager as never)
    const event = { type: "session.idle", data: { sessionID: fullSessionID } }

    //#when
    await hook.event(event as never)

    //#then
    expect(manager.handleEvent).toHaveBeenCalledTimes(1)
    expect(manager.handleEvent).toHaveBeenCalledWith(event)
    expect(logCalls.length).toBeGreaterThan(0)
    const allText = logCalls.map((c) => `${c.msg} ${JSON.stringify(c.data)}`).join("\n")
    expect(allText).toContain("session.idle")
    expect(allText).toMatch(/miss|ignore/i)
    expect(allText).toContain(fullSessionID.slice(0, 8))
    expect(allText).not.toContain(fullSessionID)
  })

  test("event without sessionID still forwards and logs ignore", async () => {
    //#given
    const manager = buildManager(undefined)
    const hook = createBackgroundNotificationHook(manager as never)
    const event = { type: "session.idle", data: {} }

    //#when
    await hook.event(event as never)

    //#then
    expect(manager.handleEvent).toHaveBeenCalledTimes(1)
    expect(manager.handleEvent).toHaveBeenCalledWith(event)
    expect(logCalls.length).toBeGreaterThan(0)
    const allText = logCalls.map((c) => `${c.msg} ${JSON.stringify(c.data)}`).join("\n")
    expect(allText).toMatch(/ignore/i)
  })
})
