import { describe, expect, it } from "bun:test"
import { deliverThroughDispatch, recordingEventHook, recordingHandlerHook, type EventInput } from "./harness"


describe("event consumer: category-skill-reminder", () => {
  it("session.idle reaches the category skill reminder", async () => {
    // given a recording stand-in for the category-skill-reminder consumer
    const received: EventInput[] = []
    // when one session.idle is delivered through the current dispatch path
    const result = await deliverThroughDispatch({
      event: { type: "session.idle", data: { sessionID: "ses_fixture" } },
      hooks: {
      categorySkillReminder: recordingEventHook(received),
      },
    })
    // then dispatch delivered it and this consumer saw the payload
    expect(result.delivered).toBe(1)
    expect(received.length).toBe(1)
    expect(received[0].type).toBe("session.idle")
    expect(received[0].data?.sessionID).toBe("ses_fixture")
  })
})
