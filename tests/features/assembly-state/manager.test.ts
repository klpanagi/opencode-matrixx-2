/// <reference types="bun-types" />
import { beforeEach, describe, expect, mock, test } from "bun:test"

type LogCall = { message: string; data?: unknown }

const logCalls: LogCall[] = []
mock.module("../../../src/shared/runtime/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data })
  },
  warn: () => {},
}))

const { _resetAssemblyStateForTesting, disableAssembly, enableAssembly, isAssemblyDisabled } =
  await import("../../../src/features/assembly-state/manager")

function logsMatching(substring: string): LogCall[] {
  return logCalls.filter((call) => call.message.includes(substring))
}

describe("assembly-state", () => {
  beforeEach(() => {
    _resetAssemblyStateForTesting()
    logCalls.length = 0
  })

  test("should start with assembly enabled (not disabled) for any session", () => {
    expect(isAssemblyDisabled("test-session")).toBe(false)
  })

  test("should mark assembly as disabled for a session", () => {
    //#given
    const sessionID = "test-session-1"

    //#when
    disableAssembly(sessionID)

    //#then
    expect(isAssemblyDisabled(sessionID)).toBe(true)
  })

  test("should re-enable assembly after disabling", () => {
    //#given
    const sessionID = "test-session-2"

    //#when
    disableAssembly(sessionID)
    const disabledAfterDisable = isAssemblyDisabled(sessionID)
    enableAssembly(sessionID)

    //#then
    expect(disabledAfterDisable).toBe(true)
    expect(isAssemblyDisabled(sessionID)).toBe(false)
  })

  test("should handle multiple sessions independently", () => {
    //#given
    const session1 = "session-1"
    const session2 = "session-2"

    //#when
    disableAssembly(session1)

    //#then
    expect(isAssemblyDisabled(session1)).toBe(true)
    expect(isAssemblyDisabled(session2)).toBe(false)
  })

  test("should not throw when enabling an already-enabled session", () => {
    //#given
    const sessionID = "test-session-3"

    //#when
    const act = () => enableAssembly(sessionID)

    //#then
    expect(act).not.toThrow()
    expect(isAssemblyDisabled(sessionID)).toBe(false)
  })

  test("should not throw when disabling an already-disabled session", () => {
    //#given
    const sessionID = "test-session-4"
    disableAssembly(sessionID)
    logCalls.length = 0

    //#when
    const act = () => disableAssembly(sessionID)

    //#then
    expect(act).not.toThrow()
    expect(isAssemblyDisabled(sessionID)).toBe(true)
  })

  test("should clear assembly state on reset", () => {
    //#given
    const sessionID = "test-session-5"
    disableAssembly(sessionID)

    //#when
    _resetAssemblyStateForTesting()

    //#then
    expect(isAssemblyDisabled(sessionID)).toBe(false)
  })

  test("should log exactly once when disabling assembly", () => {
    //#given
    const sessionID = "test-session-log-disable"

    //#when
    disableAssembly(sessionID)

    //#then
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.message).toContain("Assembly disabled")
    expect(logsMatching("Consensus disabled")).toHaveLength(0)
    expect(isAssemblyDisabled(sessionID)).toBe(true)
  })

  test("should log exactly once when enabling assembly", () => {
    //#given
    const sessionID = "test-session-log-enable"
    disableAssembly(sessionID)
    logCalls.length = 0

    //#when
    enableAssembly(sessionID)

    //#then
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.message).toContain("Assembly enabled")
    expect(logsMatching("Consensus enabled")).toHaveLength(0)
    expect(isAssemblyDisabled(sessionID)).toBe(false)
  })
})
