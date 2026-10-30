import { afterEach, describe, expect, it } from "bun:test"
import { _resetForTesting, setMainSession } from "../../../src/features/session-state/state"
import { deliverThroughPump } from "./harness"

describe("event consumer: session-recovery", () => {
  afterEach(() => {
    _resetForTesting()
  })

  it("resumes the main session with continue after a recoverable error", async () => {
    // given the failing session is the main session and recovery reports success
    const sessionID = "ses_recovery_fixture"
    setMainSession(sessionID)
    const prompts: Array<{
      path?: { id?: string }
      body?: { parts?: Array<{ type: string; text?: string }> }
    }> = []
    const seenErrors: unknown[] = []
    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          prompt: async (args: { path?: { id?: string }; body?: { parts?: Array<{ type: string; text?: string }> } }) => {
            prompts.push(args)
            return {}
          },
        },
      },
    }
    const error = { name: "ProviderAuthError" }

    // when a recoverable session.error is delivered through the pump
    const result = await deliverThroughPump({
      event: { type: "session.error", properties: { sessionID, messageID: "msg_fixture", error } },
      ctx,
      hooks: {
        sessionRecovery: {
          isRecoverableError: (candidate: unknown) => {
            seenErrors.push(candidate)
            return true
          },
          handleSessionRecovery: async () => true,
        },
      },
    })

    // then the hook judged the error and the main session was nudged to continue
    expect(result.delivered).toBe(1)
    expect(seenErrors).toEqual([error])
    expect(prompts.length).toBe(1)
    expect(prompts[0].path?.id).toBe(sessionID)
    expect(prompts[0].body?.parts?.[0]?.text).toBe("continue")
  })

  it("does not resume a session that is not the main session", async () => {
    // given a different session owns main-session tracking
    setMainSession("ses_other")
    const prompts: unknown[] = []
    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          prompt: async (args: unknown) => {
            prompts.push(args)
            return {}
          },
        },
      },
    }

    // when a recoverable error arrives for a non-main session
    const result = await deliverThroughPump({
      event: { type: "session.error", properties: { sessionID: "ses_recovery_fixture", error: { name: "E" } } },
      ctx,
      hooks: {
        sessionRecovery: { isRecoverableError: () => true, handleSessionRecovery: async () => true },
      },
    })

    // then nothing is prompted
    expect(result.delivered).toBe(1)
    expect(prompts.length).toBe(0)
  })

  it("ignores an error the hook does not consider recoverable", async () => {
    // given the main session but an unrecoverable error
    const sessionID = "ses_recovery_fixture"
    setMainSession(sessionID)
    const prompts: unknown[] = []
    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          prompt: async (args: unknown) => {
            prompts.push(args)
            return {}
          },
        },
      },
    }

    // when the error is delivered
    await deliverThroughPump({
      event: { type: "session.error", properties: { sessionID, error: { name: "Unknown" } } },
      ctx,
      hooks: {
        sessionRecovery: { isRecoverableError: () => false, handleSessionRecovery: async () => true },
      },
    })

    // then no recovery attempt and no resume happen
    expect(prompts.length).toBe(0)
  })
})
