import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: context-window-monitor", () => {
  it("message.updated reaches the context window monitor with token usage intact", async () => {
    // given a recording stand-in for the context-window-monitor consumer
    const received: EventInput[] = []
    // when one message.updated is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "message.updated", data: { info: { id: "msg_fixture", sessionID: "ses_fixture", role: "assistant", tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } } } },
      hooks: {
      contextWindowMonitor: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("message.updated")
    const info = received[0].data?.info as { tokens?: { input?: number } }
    expect(info.tokens?.input).toBe(100)
  })
})
