import { afterEach, describe, expect, it } from "bun:test"
import { _resetForTesting } from "../../../src/features/session-state/state"
import { deliverThroughDispatch, recordingEventHook, type EventInput } from "./harness"

describe("event consumer: session-status-normalizer", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("session.status idle reaches every consumer as a synthetic session.idle", async () => {
    // given a recording consumer
    const received: EventInput[] = []

    // when an idle session status is delivered
    const result = await deliverThroughDispatch({
      event: { type: "session.status", data: { sessionID: "ses_idle_fixture", status: { type: "idle" } } },
      hooks: { rulesInjector: recordingEventHook(received) },
    })

    // then the original status and the synthesized idle both arrive in order
    expect(result.delivered).toBe(1)
    expect(received.map((item) => item.type)).toEqual(["session.status", "session.idle"])
    expect(received[1].data?.sessionID).toBe("ses_idle_fixture")
  })

  it("a non-idle status is delivered once and never synthesized", async () => {
    // given a recording consumer
    const received: EventInput[] = []

    // when a busy session status is delivered
    await deliverThroughDispatch({
      event: { type: "session.status", data: { sessionID: "ses_idle_fixture", status: { type: "busy" } } },
      hooks: { rulesInjector: recordingEventHook(received) },
    })

    // then only the original event arrives
    expect(received.map((item) => item.type)).toEqual(["session.status"])
  })
})

