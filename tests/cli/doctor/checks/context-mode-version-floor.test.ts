/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  CONTEXT_MODE_VERSION_FLOOR,
  evaluateContextModeVersion,
  isContextModeVersionBelowFloor,
} from "../../../../src/cli/doctor/checks/context-mode"

describe("context-mode version floor (2.1.0)", () => {
  test("floor constant pins 2.1.0", () => {
    //#given the locked floor
    //#when inspected
    //#then it is the 2.1 line
    expect(CONTEXT_MODE_VERSION_FLOOR).toBe("2.1.0")
  })

  test("2.0.9 yields warn with upgrade message", () => {
    //#given a pre-floor discipline version
    const version = "2.0.9"

    //#when evaluated
    const below = isContextModeVersionBelowFloor(version)
    const result = evaluateContextModeVersion(version)

    //#then warn + upgrade guidance
    expect(below).toBe(true)
    expect(result.status).toBe("warn")
    expect(`${result.message} ${result.detail ?? ""}`).toMatch(/upgrade|2\.1/i)
  })

  test("2.1.0 passes the floor", () => {
    //#given the exact floor version
    const version = "2.1.0"

    //#when evaluated
    //#then not below, passes
    expect(isContextModeVersionBelowFloor(version)).toBe(false)
    expect(evaluateContextModeVersion(version).status).toBe("pass")
  })

  test("2.1.3 passes the floor", () => {
    //#given the locked version
    const version = "2.1.3"

    //#when evaluated
    //#then not below, passes
    expect(isContextModeVersionBelowFloor(version)).toBe(false)
    expect(evaluateContextModeVersion(version).status).toBe("pass")
  })

  test("2.1.0-next prerelease counts as at-floor (documents prerelease handling)", () => {
    //#given a prerelease on the floor line
    const version = "2.1.0-next"

    //#when evaluated
    //#then prerelease suffix stripped, major.minor compared -> not below
    expect(isContextModeVersionBelowFloor(version)).toBe(false)
    expect(evaluateContextModeVersion(version).status).toBe("pass")
  })

  test("null version fail-opens to pass (never blocks doctor)", () => {
    //#given no version resolved
    //#when evaluated
    //#then fail-open
    expect(isContextModeVersionBelowFloor(null)).toBe(false)
    expect(evaluateContextModeVersion(null).status).toBe("pass")
  })
})
