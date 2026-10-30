import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: background-notification", () => {
  it("message.updated reaches the background notifier with its info payload", async () => {
    // given a recording stand-in for the background-notification consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "message.updated", data: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant" } } },
      hooks: {
      backgroundNotificationHook: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("message.updated")
    const info = received[0].data?.info as { id?: string }
    expect(info.id).toBe("msg_fixture")
  })
})
