import { describe, expect, it } from "bun:test"
import { deliverThroughPump, recordingEventHook, recordingHandlerHook } from "./harness"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("event consumer: context-window-monitor", () => {
  it("message.updated reaches the context window monitor with token usage intact", async () => {
    // given a recording stand-in for the context-window-monitor consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current pump path
    const result = await deliverThroughPump({
      event: { type: "message.updated", properties: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant", tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } } } },
      hooks: {
      contextWindowMonitor: recordingEventHook(received),
      },
    })
    // then the pump delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].event.type).toBe("message.updated")
    const info = received[0].event.properties?.info as { tokens?: { input?: number } }
    expect(info.tokens?.input).toBe(100)
  })
})
