import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: knowledge-hub-injector", () => {
  it("message.updated reaches the knowledge hub injector", async () => {
    // given a recording stand-in for the knowledge-hub-injector consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "message.updated", data: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "user" } } },
      hooks: {
      knowledgeHubInjector: recordingEventHook(received),
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
