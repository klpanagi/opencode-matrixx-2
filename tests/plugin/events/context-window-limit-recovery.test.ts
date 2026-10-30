import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: context-window-limit-recovery", () => {
  it("session.error reaches the context window recovery with the error payload", async () => {
    // given a recording stand-in for the context-window-limit-recovery consumer
    const received: EventInput[] = []
    // when one session.error is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "session.error", properties: { sessionID: "ses_fixture", error: { name: "ContextLimit" } } },
      hooks: {
      contextWindowLimitRecovery: recordingEventHook(received),
      },
    })
    // then the pump delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].event.type).toBe("session.error")
    const error = received[0].event.properties?.error as { name?: string }
    expect(error.name).toBe("ContextLimit")
  })
})
