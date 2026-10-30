import { afterEach, describe, expect, it } from "bun:test"
import { _resetForTesting } from "../../../src/features/session-state/state"
import { deliverThroughPump } from "./harness"

type SessionInfo = { id?: string; title?: string; parentID?: string }

describe("event consumer: first-message-variant-gate", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("session.created marks the session as created for variant selection", async () => {
    // given a recording gate
    const created: Array<SessionInfo | undefined> = []
    const cleared: string[] = []
    const gate = {
      markSessionCreated: (info: SessionInfo | undefined) => {
        created.push(info)
      },
      clear: (sessionID: string) => {
        cleared.push(sessionID)
      },
    }

    // when a session is created
    const result = await deliverThroughPump({
      event: { type: "session.created", properties: { info: { id: "ses_gate_fixture", title: "Fixture" } } },
      firstMessageVariantGate: gate,
    })

    // then the gate saw the session info and nothing was cleared
    expect(result.delivered).toBe(1)
    expect(created.length).toBe(1)
    expect(created[0]?.id).toBe("ses_gate_fixture")
    expect(cleared.length).toBe(0)
  })

  it("session.deleted clears the gate for that session", async () => {
    // given a recording gate
    const created: Array<SessionInfo | undefined> = []
    const cleared: string[] = []
    const gate = {
      markSessionCreated: (info: SessionInfo | undefined) => {
        created.push(info)
      },
      clear: (sessionID: string) => {
        cleared.push(sessionID)
      },
    }

    // when a session is deleted
    await deliverThroughPump({
      event: { type: "session.deleted", properties: { info: { id: "ses_gate_fixture" } } },
      firstMessageVariantGate: gate,
    })

    // then the gate is cleared for that session and never marked
    expect(cleared).toEqual(["ses_gate_fixture"])
    expect(created.length).toBe(0)
  })
})

