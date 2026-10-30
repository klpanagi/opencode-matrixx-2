import { describe, expect, it } from "bun:test"
import {
  fetchSessionMessages,
  messagesOf,
  type SessionContextCarrier,
} from "../../src/shared/session-context-source"

describe("messagesOf", () => {
  it("keeps a bare message array", () => {
    const messages = [{ id: "m1", type: "assistant" }]
    expect(messagesOf(messages)).toBe(messages)
  })

  it("unwraps the { messages } object", () => {
    const messages = [{ id: "m1" }]
    expect(messagesOf({ messages })).toBe(messages)
  })

  it("returns an empty array for non-message payloads", () => {
    expect(messagesOf(undefined)).toEqual([])
    expect(messagesOf(null)).toEqual([])
    expect(messagesOf("text")).toEqual([])
    expect(messagesOf({ messages: "nope" })).toEqual([])
  })
})

describe("fetchSessionMessages", () => {
  it("passes the sessionID to the native context and unwraps the result once", async () => {
    const calls: Array<{ sessionID: string }> = []
    const carrier: SessionContextCarrier = {
      session: {
        async context(input) {
          calls.push(input)
          return { messages: [{ id: "a", type: "assistant" }] }
        },
      },
    }

    const result = await fetchSessionMessages(carrier, "ses_1")

    expect(calls).toEqual([{ sessionID: "ses_1" }])
    expect(result).toEqual([{ id: "a", type: "assistant" }])
  })

  it("propagates a rejection so callers keep their catch handling", async () => {
    const carrier: SessionContextCarrier = {
      session: {
        async context() {
          throw new Error("context failed")
        },
      },
    }

    await expect(fetchSessionMessages(carrier, "ses_1")).rejects.toThrow("context failed")
  })
})
