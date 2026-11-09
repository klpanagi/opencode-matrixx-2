/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import * as constants from "../../../src/features/background-agent/constants"

describe("background-agent constants surface", () => {
  test("retains the config-backed and test-pinned constants", () => {
    //#given the background-agent constants module
    //#when inspecting the retained exports
    //#then the live values are unchanged
    expect(constants.DEFAULT_WALL_CLOCK_TIMEOUT_MS).toBe(0)
    expect(constants.MIN_IDLE_TIME_MS).toBe(5000)
    expect(constants.TASK_TTL_MS).toBe(30 * 60 * 1000)
    expect(constants.KNOWN_SESSIONS_MAX).toBe(200)
  })

  test("no longer exports the dead staleness and lifecycle constants", () => {
    //#given the trimmed constants module
    //#when checking the removed declarations
    //#then every dead name is absent
    expect("DEFAULT_STALE_TIMEOUT_MS" in constants).toBe(false)
    expect("DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS" in constants).toBe(false)
    expect("MIN_RUNTIME_BEFORE_STALE_MS" in constants).toBe(false)
    expect("POLLING_INTERVAL_MS" in constants).toBe(false)
    expect("PRUNE_THROTTLE_MS" in constants).toBe(false)
    expect("TASK_CLEANUP_DELAY_MS" in constants).toBe(false)
    expect("DEFAULT_WALL_CLOCK_ABORT_GRACE_MS" in constants).toBe(false)
    expect("RECONCILE_CONFIRMATION_GRACE_MS" in constants).toBe(false)
  })

  test("no longer exports the wake scheduler or job board constants", () => {
    //#given the trimmed constants module
    //#when checking the inert config defaults
    //#then all six are absent (the config schemas stay in T-54)
    expect("DEFAULT_WAKE_SCHEDULER_ENABLED" in constants).toBe(false)
    expect("DEFAULT_WAKE_INTERVAL_MS" in constants).toBe(false)
    expect("MIN_WAKE_INTERVAL_MS" in constants).toBe(false)
    expect("DEFAULT_JOB_BOARD_ENABLED" in constants).toBe(false)
    expect("DEFAULT_JOB_BOARD_STRATEGY" in constants).toBe(false)
    expect("DEFAULT_MAX_RETAINED_SNAPSHOTS" in constants).toBe(false)
  })
})
