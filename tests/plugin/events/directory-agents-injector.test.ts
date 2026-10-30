import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: directory-agents-injector", () => {
  it("session.created reaches the directory agents injector with the session info", async () => {
    // given a recording stand-in for the directory-agents-injector consumer
    const received: EventInput[] = []
    // when one session.created is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.created", data: { info: { id: "ses_new", title: "Fixture" } } },
      hooks: {
      directoryAgentsInjector: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.created")
    const info = received[0].data?.info as { id?: string }
    expect(info.id).toBe("ses_new")
  })
})
