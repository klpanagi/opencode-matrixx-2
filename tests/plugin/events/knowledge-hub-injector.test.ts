import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: knowledge-hub-injector", () => {
  it("message.updated reaches the knowledge hub injector", async () => {
    // given a recording stand-in for the knowledge-hub-injector consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "message.updated", properties: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "user" } } },
      hooks: {
      knowledgeHubInjector: recordingEventHook(received),
      },
    })
    // then the pump delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].event.type).toBe("message.updated")
    const info = received[0].event.properties?.info as { id?: string }
    expect(info.id).toBe("msg_fixture")
  })
})
