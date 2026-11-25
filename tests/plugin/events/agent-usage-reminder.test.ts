import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: agent-usage-reminder", () => {
  it("session.compacted reaches the usage reminder", async () => {
    // given a recording stand-in for the agent-usage-reminder consumer
    const received: EventInput[] = []
    // when one session.compacted is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.compacted", data: { sessionID: "ses_fixture" } },
      hooks: {
      agentUsageReminder: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.compacted")
    expect(received[0].data?.sessionID).toBe("ses_fixture")
  })
})
