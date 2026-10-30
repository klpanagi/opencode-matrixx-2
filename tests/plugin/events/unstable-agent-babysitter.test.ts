import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: unstable-agent-babysitter", () => {
  it("message.updated reaches the unstable agent babysitter", async () => {
    // given a recording stand-in for the unstable-agent-babysitter consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "message.updated", properties: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant" } } },
      hooks: {
      unstableAgentBabysitter: recordingEventHook(received),
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
