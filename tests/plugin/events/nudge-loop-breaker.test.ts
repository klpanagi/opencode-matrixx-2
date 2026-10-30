import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: nudge-loop-breaker", () => {
  it("message.updated reaches the nudge loop breaker", async () => {
    // given a recording stand-in for the nudge-loop-breaker consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "message.updated", data: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant" } } },
      hooks: {
      nudgeLoopBreaker: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("message.updated")
    const info = received[0].data?.info as { sessionID?: string }
    expect(info.sessionID).toBe("ses_fixture")
  })
})
