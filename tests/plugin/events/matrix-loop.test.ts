import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: matrix-loop", () => {
  it("session.idle reaches the matrix loop", async () => {
    // given a recording stand-in for the matrix-loop consumer
    const received: EventInput[] = []
    // when one session.idle is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "session.idle", properties: { sessionID: "ses_fixture" } },
      hooks: {
      matrixLoop: recordingEventHook(received),
      },
    })
    // then the pump delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].event.type).toBe("session.idle")
    expect(received[0].event.properties?.sessionID).toBe("ses_fixture")
  })
})
