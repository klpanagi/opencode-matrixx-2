import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: unstable-agent-babysitter", () => {
  it("message.updated reaches the unstable agent babysitter", async () => {
    // given a recording stand-in for the unstable-agent-babysitter consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "message.updated", data: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant" } } },
      hooks: {
      unstableAgentBabysitter: recordingEventHook(received),
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
