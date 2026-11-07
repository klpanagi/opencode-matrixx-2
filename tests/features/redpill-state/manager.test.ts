import { describe, expect, test } from "bun:test"

import {
  _resetRedpillStateForTesting,
  disableRedpill,
  enableRedpill,
  getRedpillState,
} from "../../../src/features/redpill-state/manager"

describe("redpill-state", () => {
  test("should start with default state (undefined) for any session", () => {
    _resetRedpillStateForTesting()
    expect(getRedpillState("test-session")).toBeUndefined()
  })

  test("should enable redpill for a session", () => {
    _resetRedpillStateForTesting()
    const sessionID = "test-session-1"

    enableRedpill(sessionID)

    expect(getRedpillState(sessionID)).toBe("enabled")
  })

  test("should disable redpill for a session", () => {
    _resetRedpillStateForTesting()
    const sessionID = "test-session-2"

    disableRedpill(sessionID)

    expect(getRedpillState(sessionID)).toBe("disabled")
  })

  test("should toggle between enabled and disabled", () => {
    _resetRedpillStateForTesting()
    const sessionID = "test-session-3"

    enableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("enabled")

    disableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("disabled")

    enableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("enabled")
  })

  test("should handle multiple sessions independently", () => {
    _resetRedpillStateForTesting()
    const session1 = "session-1"
    const session2 = "session-2"

    enableRedpill(session1)
    disableRedpill(session2)

    expect(getRedpillState(session1)).toBe("enabled")
    expect(getRedpillState(session2)).toBe("disabled")
  })

  test("should return to default state after clearing", () => {
    _resetRedpillStateForTesting()
    const sessionID = "test-session-4"

    enableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("enabled")

    disableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("disabled")
  })

  test("should clear redpill state on reset", () => {
    _resetRedpillStateForTesting()
    const sessionID = "test-session-5"

    enableRedpill(sessionID)
    expect(getRedpillState(sessionID)).toBe("enabled")

    _resetRedpillStateForTesting()
    expect(getRedpillState(sessionID)).toBeUndefined()
  })
})
