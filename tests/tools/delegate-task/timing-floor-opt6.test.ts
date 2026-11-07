/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { getTimingConfig } from "../../../src/tools/delegate-task/timing"

describe("timing poll floor (Opt-6)", () => {
  test("exposes MIN_POLL_TIME_FLOOR_MS of 50 used by sync-task and poller", async () => {
    //#given
    const config = getTimingConfig() as Record<string, unknown>

    //#when
    const floor = config["MIN_POLL_TIME_FLOOR_MS"]

    //#then
    expect(floor).toBe(50)
  })
})
