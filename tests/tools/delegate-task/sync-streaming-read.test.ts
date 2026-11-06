declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach, afterEach } = require("bun:test") as typeof import("bun:test")

import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

function createMockCtx(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal,
  }
}

describe("sync streaming read", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("isSessionComplete returns false when the newest assistant message is streaming", async () => {
    //#given
    const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")
    const messages = [
      { id: "msg_001", type: "user", time: { created: 1000 } },
      {
        id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
        content: [{ type: "text", text: "A" }],
      },
      {
        id: "msg_003", type: "assistant", time: { created: 4000 }, finish: "stop",
        content: [],
      },
    ]
    //#when
    const result = isSessionComplete(messages)
    //#then
    expect(result).toBe(false)
  })

  test("isSessionComplete stays true for payloads without time.completed", async () => {
    //#given
    const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")
    const messages = [
      { id: "msg_001", type: "user", time: { created: 1000 } },
      {
        id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "stop",
        content: [{ type: "text", text: "A" }],
      },
      {
        id: "msg_003", type: "assistant", time: { created: 4000 }, finish: "stop",
        content: [],
      },
    ]
    //#when
    const result = isSessionComplete(messages)
    //#then
    expect(result).toBe(true)
  })

  test("pollSyncSession keeps polling past a streaming placeholder until the terminal message lands", async () => {
    //#given
    const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")
    let callCount = 0
    const streamingCycle = {
      messages: [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        {
          id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
          content: [{ type: "text", text: "First pass done" }],
        },
        {
          id: "msg_003", type: "assistant", time: { created: 4000 },
          content: [],
        },
      ],
    }
    const terminal = {
      messages: [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        {
          id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
          content: [{ type: "text", text: "First pass done" }],
        },
        {
          id: "msg_003", type: "assistant", time: { created: 4000, completed: 5000 }, finish: "stop",
          content: [{ type: "text", text: "FINAL ANSWER" }],
        },
      ],
    }
    const mockClient = {
      session: {
        context: async () => {
          callCount++
          if (callCount <= 3) return streamingCycle
          return terminal
        },
        status: async () => ({ data: {} }),
      },
    }
    //#when
    const result = await pollSyncSession(createMockCtx(), mockClient, {
      sessionID: "ses_test",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
    })
    //#then
    expect(result).toBeNull()
    expect(callCount).toBeGreaterThan(2)
    const fetched = await fetchSyncResult(
      { session: { context: async () => terminal } },
      "ses_test",
    )
    expect(fetched).toEqual({ ok: true, textContent: "FINAL ANSWER" })
  })

  test("fetchSyncResult refuses to return an interim step while the newest assistant is streaming", async () => {
    //#given
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")
    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
              content: [{ type: "text", text: "First pass done" }],
            },
            {
              id: "msg_003", type: "assistant", time: { created: 4000 },
              content: [],
            },
          ],
        }),
      },
    }
    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")
    //#then
    expect((result as { ok: boolean }).ok).toBe(false)
    expect((result as { error: string }).error).toMatch("still streaming")
  })

  test("fetchSyncResult returns the settled text when the newest settled assistant is textless", async () => {
    //#given - V2 payload: a settled tool-call step with no text trails the answered step
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")
    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
              content: [{ type: "text", text: "Settled answer" }],
            },
            {
              id: "msg_003", type: "assistant", time: { created: 4000, completed: 5000 }, finish: "tool-calls",
              content: [{ type: "tool-call" }],
            },
          ],
        }),
      },
    }
    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")
    //#then - must surface the settled text, never the empty tool-call step
    expect(result).toEqual({ ok: true, textContent: "Settled answer" })
  })

  test("fetchSyncResult refuses a half-streamed row that already contains a complete tag pair", async () => {
    //#given - newest assistant is still streaming but its partial text closes a <plan> pair
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")
    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
              content: [{ type: "text", text: "Interim narration" }],
            },
            {
              id: "msg_003", type: "assistant", time: { created: 4000 },
              content: [{ type: "text", text: "<plan>half written</plan>" }],
            },
          ],
        }),
      },
    }
    //#when
    const result = await fetchSyncResult(mockClient, "ses_test", undefined, { deliverableTag: "plan" })
    //#then - the tag fast path must not short-circuit the streaming guard
    expect((result as { ok: boolean }).ok).toBe(false)
    expect((result as { error: string }).error).toMatch("still streaming")
  })

  test("poll timeout never quotes text from a row that is still streaming", async () => {
    //#given - a settled answer followed by a streaming row carrying partial text
    const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")
    __setTimingConfig({
      POLL_INTERVAL_MS: 20,
      MIN_STABILITY_TIME_MS: 60000,
      STABILITY_POLLS_REQUIRED: 3,
      MAX_POLL_TIME_MS: 90,
    })
    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000, completed: 3000 }, finish: "stop",
              content: [{ type: "text", text: "Settled answer" }],
            },
            {
              id: "msg_003", type: "assistant", time: { created: 4000 },
              content: [{ type: "text", text: "PARTIAL-DO-NOT-QUOTE" }],
            },
          ],
        }),
        status: async () => ({ data: {} }),
      },
    }
    //#when
    const result = (await pollSyncSession(createMockCtx(), mockClient, {
      sessionID: "ses_timeout",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
    })) ?? ""
    //#then - the outcome snapshot quotes the settled answer, never the half-written row
    expect(result).toContain("Poll timeout reached")
    expect(result).toContain("Settled answer")
    expect(result).not.toContain("PARTIAL-DO-NOT-QUOTE")
  })

  test("fetchSyncResult unchanged for legacy payloads", async () => {
    //#given
    const { fetchSyncResult } = require("../../../src/tools/delegate-task/sync-result-fetcher")
    const mockClient = {
      session: {
        context: async () => ({
          messages: [
            { id: "msg_001", type: "user", time: { created: 1000 } },
            {
              id: "msg_002", type: "assistant", time: { created: 2000 },
              content: [{ type: "text", text: "First response" }],
            },
            { id: "msg_003", type: "user", time: { created: 3000 } },
            {
              id: "msg_004", type: "assistant", time: { created: 4000 },
              content: [{ type: "text", text: "Latest response" }],
            },
          ],
        }),
      },
    }
    //#when
    const result = await fetchSyncResult(mockClient, "ses_test")
    //#then
    expect(result).toEqual({ ok: true, textContent: "Latest response" })
  })
})
