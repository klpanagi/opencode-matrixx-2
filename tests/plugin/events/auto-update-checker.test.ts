import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: auto-update-checker", () => {
  it("session.created reaches the update checker", async () => {
    // given a recording stand-in for the auto-update-checker consumer
    const received: EventInput[] = []
    // when one session.created is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.created", data: { info: { id: "ses_fixture", title: "Fixture" } } },
      hooks: {
      autoUpdateChecker: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.created")
    expect((received[0].data?.info as { id?: string }).id).toBe("ses_fixture")
  })
})
