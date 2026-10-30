import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: directory-agents-injector", () => {
  it("session.created reaches the directory agents injector with the session info", async () => {
    // given a recording stand-in for the directory-agents-injector consumer
    const received: EventInput[] = []
    // when one session.created is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "session.created", properties: { info: { id: "ses_new", title: "Fixture" } } },
      hooks: {
      directoryAgentsInjector: recordingEventHook(received),
      },
    })
    // then the pump delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].event.type).toBe("session.created")
    const info = received[0].event.properties?.info as { id?: string }
    expect(info.id).toBe("ses_new")
  })
})
