import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: context-window-limit-recovery", () => {
  it("session.error reaches the context window recovery with the error payload", async () => {
    // given a recording stand-in for the context-window-limit-recovery consumer
    const received: EventInput[] = []
    // when one session.error is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.error", data: { sessionID: "ses_fixture", error: { name: "ContextLimit" } } },
      hooks: {
      contextWindowLimitRecovery: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.error")
    const error = received[0].data?.error as { name?: string }
    expect(error.name).toBe("ContextLimit")
  })
})
