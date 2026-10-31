declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

function createMockCtx() {
  return { sessionID: "parent", messageID: "m", agent: "a", abort: new AbortController().signal }
}

describe("fallback stability gate", () => {
  beforeEach(() => {
    __setTimingConfig({ POLL_INTERVAL_MS: 10, MIN_STABILITY_TIME_MS: 60000, STABILITY_POLLS_REQUIRED: 3, MAX_POLL_TIME_MS: 5000 })
  })
  afterEach(() => { __resetTimingConfig() })

  test("does not complete on first text without finish before stability", async () => {
    //#given - assistant text with no finish, high stability bar
    const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")
    let calls = 0
    const mockClient = {
      session: {
        context: async () => {
          calls++
          if (calls === 1) return { messages: [ { id: "msg_001", type: "user", time: { created: 1000 } }, { id: "msg_002", type: "assistant", time: { created: 2000 }, content: [{ type: "text", text: "Fixing those..." }] } ] }
          return { messages: [ { id: "msg_001", type: "user", time: { created: 1000 } }, { id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "stop", content: [{ type: "text", text: "Final plan" }] } ] }
        },
        status: async () => ({ data: {} })
      }
    }
    //#when
    const result = await pollSyncSession(createMockCtx(), mockClient, { sessionID: "ses_fallback", agentToUse: "oracle", toastManager: null, taskId: undefined })
    //#then - must skip premature fallback and reach terminal finish
    expect(result).toBeNull()
    expect(calls).toBeGreaterThan(1)
  })
})
