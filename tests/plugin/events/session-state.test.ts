import { afterEach, describe, expect, it } from "bun:test"
import {
  _resetForTesting,
  getMainSessionID,
  getSessionAgent,
} from "../../../src/features/session-state/state"
import { deliverThroughDispatch } from "./harness"

describe("event consumer: session-state", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("session.created promotes the new top-level session to main session", async () => {
    // given no session is tracked yet
    expect(getMainSessionID()).toBeUndefined()

    // when a top-level session is created
    const result = await deliverThroughDispatch({
      event: { type: "session.created", data: { info: { id: "ses_main_fixture", title: "Fixture" } } },
    })

    // then it becomes the main session
    expect(result.delivered).toBe(1)
    expect(getMainSessionID()).toBe("ses_main_fixture")
  })

  it("session.created ignores a child session", async () => {
    // given an existing main session
    await deliverThroughDispatch({
      event: { type: "session.created", data: { info: { id: "ses_parent_fixture" } } },
    })

    // when a child session is created
    await deliverThroughDispatch({
      event: { type: "session.created", data: { info: { id: "ses_child_fixture", parentID: "ses_parent_fixture" } } },
    })

    // then main-session tracking is unchanged
    expect(getMainSessionID()).toBe("ses_parent_fixture")
  })

  it("message.updated records the agent that produced a user message", async () => {
    // given a user message with an agent
    const sessionID = "ses_agent_fixture"
    expect(getSessionAgent(sessionID)).toBeUndefined()

    // when the message update is delivered
    await deliverThroughDispatch({
      event: {
        type: "message.updated",
        data: { info: { id: "msg_fixture", sessionID, role: "user", agent: "oracle" } },
      },
    })

    // then the agent is remembered for that session
    expect(getSessionAgent(sessionID)).toBe("oracle")
  })

  it("message.updated ignores assistant messages", async () => {
    // given a session with no recorded agent
    const sessionID = "ses_assistant_fixture"

    // when an assistant message arrives carrying an agent
    await deliverThroughDispatch({
      event: {
        type: "message.updated",
        data: { info: { id: "msg_fixture", sessionID, role: "assistant", agent: "oracle" } },
      },
    })

    // then nothing is recorded
    expect(getSessionAgent(sessionID)).toBeUndefined()
  })
})

