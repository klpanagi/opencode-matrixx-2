import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: think-mode", () => {
  it("session.deleted reaches think mode with the session info", async () => {
    // given a recording stand-in for the think-mode consumer
    const received: EventInput[] = []
    // when one session.deleted is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.deleted", data: { info: { id: "ses_fixture" } } },
      hooks: {
      thinkMode: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.deleted")
    const info = received[0].data?.info as { id?: string }
    expect(info.id).toBe("ses_fixture")
  })
})
