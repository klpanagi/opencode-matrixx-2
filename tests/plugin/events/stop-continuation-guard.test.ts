import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: stop-continuation-guard", () => {
  it("session.deleted reaches the stop continuation guard", async () => {
    // given a recording stand-in for the stop-continuation-guard consumer
    const received: EventInput[] = []
    // when one session.deleted is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.deleted", data: { info: { id: "ses_fixture" } } },
      hooks: {
      stopContinuationGuard: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.deleted")
    expect((received[0].data?.info as { id?: string }).id).toBe("ses_fixture")
  })
})
