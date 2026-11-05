const { describe, test, expect } = require("bun:test")

describe("fetchSyncResult orphaned tool-call", () => {
  test("newest assistant is textless tool-call: returns newest assistant WITH text", async () => {
    //#given - Niobe Phase B case (ses_e5ce0d5c): earlier assistant has fallback text, newest is tool-calls with no text
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")

    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000 },
              finish: "end_turn",
              content: [{ type: "text", text: "Fallback progress text" }],
            },
            {
              id: "msg_003", type: "assistant", time: { created: 3000 },
              finish: "tool-calls",
              content: [{ type: "tool-call", text: "" }],
            },
          ],
        }),
      },
    }

    //#when
    const result = await fetchSyncResult(mockClient, "ses_orphaned")

    //#then - must surface the fallback text, never empty
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.textContent).toBe("Fallback progress text")
    }
  })
})
