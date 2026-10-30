import { describe, expect, it } from "bun:test"
import { readMessagesFromSDK, readPartsFromSDK } from "../../../../src/hooks/session-recovery/storage"
import { readMessages } from "../../../../src/hooks/session-recovery/storage/messages-reader"
import { readParts } from "../../../../src/hooks/session-recovery/storage/parts-reader"

function createMockClient(handlers: {
  messages?: (sessionID: string) => unknown[]
}) {
  return {
    session: {
      context: async (opts: { sessionID: string }) => {
        if (handlers.messages) {
          return handlers.messages(opts.sessionID)
        }
        throw new Error("not implemented")
      },
    },
  } as unknown
}

describe("session-recovery storage SDK readers", () => {
  it("readPartsFromSDK returns empty array when fetch fails", async () => {
    //#given a client that throws on request
    const client = createMockClient({}) as Parameters<typeof readPartsFromSDK>[0]

    //#when readPartsFromSDK is called
    const result = await readPartsFromSDK(client, "ses_test", "msg_test")

    //#then it returns empty array
    expect(result).toEqual([])
  })

  it("readPartsFromSDK returns its documented empty array, because the V1 per-message read never resolved data", async () => {
    //#given a native context that carries messages for the session
    const sessionID = "ses_test"
    const messageID = "msg_test"
    const storedParts = [
      { id: "prt_1", sessionID, messageID, type: "text", text: "hello" },
    ]

    const client = createMockClient({
      messages: () => [{ id: messageID, content: storedParts }],
    }) as Parameters<typeof readPartsFromSDK>[0]

    //#when readPartsFromSDK is called
    const result = await readPartsFromSDK(client, sessionID, messageID)

    //#then it still reports no parts, matching the dead V1 fallback
    expect(result).toEqual([])
  })

  it("readMessagesFromSDK normalizes and sorts messages", async () => {
    //#given a client that returns messages list
    const sessionID = "ses_test"
    const client = createMockClient({
      messages: () => [
        { id: "msg_b", role: "assistant", time: { created: 2 } },
        { id: "msg_a", role: "user", time: { created: 1 } },
        { id: "msg_c" },
      ],
    }) as Parameters<typeof readMessagesFromSDK>[0]

    //#when readMessagesFromSDK is called
    const result = await readMessagesFromSDK(client, sessionID)

    //#then it returns sorted StoredMessageMeta with defaults
    expect(result).toEqual([
      { id: "msg_c", sessionID, role: "user", time: { created: 0 } },
      { id: "msg_a", sessionID, role: "user", time: { created: 1 } },
      { id: "msg_b", sessionID, role: "assistant", time: { created: 2 } },
    ])
  })

  it("readParts returns empty array for nonexistent message", () => {
    //#given a message ID that has no stored parts
    //#when readParts is called
    const parts = readParts("msg_nonexistent")

    //#then it returns empty array
    expect(parts).toEqual([])
  })

  it("readMessages returns empty array for nonexistent session", () => {
    //#given a session ID that has no stored messages
    //#when readMessages is called
    const messages = readMessages("ses_nonexistent")

    //#then it returns empty array
    expect(messages).toEqual([])
  })
})
