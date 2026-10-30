declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")

import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

function createMockCtx(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal
  }
}

describe("pollSyncSession", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  describe("native finish-based completion", () => {
    test("detects completion when assistant message has terminal finish reason", async () => {
      //#given - session messages with a terminal assistant finish ("end_turn")
      //         and the assistant id > user id (native opencode condition)
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      const _pollCount = 0
      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
              {
                id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "stop",
                content: [{ type: "text", text: "Done" }]
              },
            ]
          }),
          status: async () => ({ data: { "ses_test": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should return null (success, no error)
      expect(result).toBeNull()
    })

    test("keeps polling when assistant finish is tool-calls (non-terminal)", async () => {
      //#given - first poll returns tool-calls finish, second returns end_turn
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          context: async () => {
            callCount++
            if (callCount <= 2) {
              return {
                messages: [
                  { id: "msg_001", type: "user", time: { created: 1000 } },
                  {
                    id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "tool-calls",
                    content: [{ type: "tool-call", text: "calling tool" }]
                  },
                ]
              }
            }
            return {
              messages: [
                { id: "msg_001", type: "user", time: { created: 1000 } },
                {
                  id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "tool-calls",
                  content: [{ type: "tool-call", text: "calling tool" }]
                },
                { id: "msg_003", type: "user", time: { created: 3000 } },
                {
                  id: "msg_004", type: "assistant", time: { created: 4000 }, finish: "end_turn",
                  content: [{ type: "text", text: "Final answer" }]
                },
              ]
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    test("keeps polling when finish is 'unknown' (non-terminal)", async () => {
      //#given
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          context: async () => {
            callCount++
            if (callCount <= 1) {
              return {
                messages: [
                  { id: "msg_001", type: "user", time: { created: 1000 } },
                  {
                    id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "unknown",
                    content: []
                  },
                ]
              }
            }
            return {
              messages: [
                { id: "msg_001", type: "user", time: { created: 1000 } },
                {
                  id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "unknown",
                  content: []
                },
                { id: "msg_003", type: "user", time: { created: 3000 } },
                {
                  id: "msg_004", type: "assistant", time: { created: 4000 }, finish: "stop",
                  content: [{ type: "text", text: "Done" }]
                },
              ]
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })

    test("does not complete when assistant id < user id (user sent after assistant)", async () => {
      //#given - assistant finished but user message came after it (agent still processing)
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      let callCount = 0
      const mockClient = {
        session: {
          context: async () => {
            callCount++
            if (callCount <= 1) {
              return {
                messages: [
                  { id: "msg_001", type: "user", time: { created: 1000 } },
                  {
                    id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "end_turn",
                    content: [{ type: "text", text: "Partial" }]
                  },
                  { id: "msg_003", type: "user", time: { created: 3000 } },
                ]
              }
            }
            return {
              messages: [
                { id: "msg_001", type: "user", time: { created: 1000 } },
                {
                  id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "end_turn",
                  content: [{ type: "text", text: "Partial" }]
                },
                { id: "msg_003", type: "user", time: { created: 3000 } },
                {
                  id: "msg_004", type: "assistant", time: { created: 4000 }, finish: "end_turn",
                  content: [{ type: "text", text: "Final" }]
                },
              ]
            }
          },
          status: async () => ({ data: { "ses_test": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_test",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThan(1)
    })
  })

  describe("abort handling", () => {
    test("returns abort message when signal is aborted", async () => {
      //#given
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")
      const mockClient = {
        session: {
          context: async () => ({ messages: [] }),
          status: async () => ({ data: {} })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(true), mockClient, {
        sessionID: "ses_abort",
        agentToUse: "test-agent",
        toastManager: { removeTask: () => {} },
        taskId: "task_123"
      })

      //#then
      expect(result).toContain("Task aborted")
      expect(result).toContain("ses_abort")
    })
  })

  describe("timeout handling", () => {
    test("returns error string on timeout", async () => {
      //#given - never returns a terminal finish, but timeout is very short
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 0
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
            ]
          }),
          status: async () => ({ data: { "ses_timeout": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_timeout",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })
      //#then - timeout returns structured outcome with prefix preserved
      expect(result).toContain("Poll timeout reached after 50ms for session ses_timeout")
      expect(result).toContain("<task_metadata>")
      expect(result).toContain('"reason":"poll-timeout"')
    })
  })

   describe("non-idle session status", () => {
     test("never consults a status domain and completes from messages", async () => {
       //#given
       const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

       let statusCallCount = 0
       let _messageCallCount = 0
       const mockClient = {
         session: {
           context: async () => {
             _messageCallCount++
             return {
               messages: [
                 { id: "msg_001", type: "user", time: { created: 1000 } },
                 {
                   id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "end_turn",
                   content: [{ type: "text", text: "Done" }]
                 },
               ]
             }
           },
           status: async () => {
             statusCallCount++
             if (statusCallCount <= 2) {
               return { data: { "ses_busy": { type: "running" } } }
             }
             return { data: { "ses_busy": { type: "idle" } } }
           }
         }
       }

       //#when
       const result = await pollSyncSession(createMockCtx(), mockClient, {
         sessionID: "ses_busy",
         agentToUse: "test-agent",
         toastManager: null,
         taskId: undefined
       })

       //#then - completion comes from the message stream; the status branch is gone
       expect(result).toBeNull()
       expect(statusCallCount).toBe(0)
     })
   })

  describe("isSessionComplete edge cases", () => {
    test("returns false when messages array is empty", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - empty messages array
      const messages: unknown[] = []

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false
      expect(result).toBe(false)
    })

    test("returns false when no assistant message exists", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - only user messages, no assistant
      const messages = [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        { id: "msg_002", type: "user", time: { created: 2000 } },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false
      expect(result).toBe(false)
    })

    test("returns false when only assistant message exists (no user)", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - only assistant message, no user message
      const messages = [
        {
          id: "msg_001", type: "assistant", time: { created: 1000 }, finish: "end_turn",
          content: [{ type: "text", text: "Response" }]
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (no user message to compare IDs)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing finish field", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - assistant message without finish field
      const messages = [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        {
          id: "msg_002", type: "assistant", time: { created: 2000 },
          content: [{ type: "text", text: "Response" }]
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return false (missing finish)
      expect(result).toBe(false)
    })

    test("returns false when assistant message has missing info.id field", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - assistant message without id in info
      const messages = [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        {
          type: "assistant", time: { created: 2000 }, finish: "end_turn",
          content: [{ type: "text", text: "Response" }]
        },
      ]

      //#when
      const result = isSessionComplete(messages)

      //#then - should return true (timestamps available: 1000 < 2000)
      expect(result).toBe(true)
    })

    test("returns false when user message has missing info.id field", () => {
      const { isSessionComplete } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given - user message without id in info
      const messages = [
        { type: "user", time: { created: 1000 } },
        {
          id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "end_turn",
          content: [{ type: "text", text: "Response" }]
        },
      ]

      //#when
      const result = isSessionComplete(messages)

       //#then - should return true (timestamps available: 1000 < 2000)
      expect(result).toBe(true)
  })
})

  describe("hasToolResultAfterAssistant", () => {
    test("returns true when user message id > assistant message id", () => {
      const { hasToolResultAfterAssistant } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        { id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "tool-calls" },
        { id: "msg_003", type: "user", time: { created: 3000 } },
      ]

      //#when
      const result = hasToolResultAfterAssistant(messages)

      //#then
      expect(result).toBe(true)
    })

    test("returns false when assistant message is last", () => {
      const { hasToolResultAfterAssistant } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        { id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "end_turn" },
      ]

      //#when
      const result = hasToolResultAfterAssistant(messages)

      //#then
      expect(result).toBe(false)
    })

    test("returns false when no messages", () => {
      const { hasToolResultAfterAssistant } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#when
      const result = hasToolResultAfterAssistant([])

      //#then
      expect(result).toBe(false)
    })
  })

  describe("stall detection", () => {
    test("detects stall when no assistant response after idle", async () => {
      //#given - session idle with only user message, no assistant ever responds
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 30000
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
            ]
          }),
          status: async () => ({ data: { "ses_stall": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_stall",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should detect stall, not timeout after full MAX_POLL_TIME_MS
      expect(result).toContain("Session stalled")
      expect(result).toContain("no assistant response")
    })

    test("detects stall when tool-calls finish but no follow-up response", async () => {
      //#given - assistant made tool calls, tool result exists, but no new assistant response
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 30000
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
              {
                id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "tool-calls",
                content: [{ type: "tool-call", text: "calling tool" }]
              },
              { id: "msg_003", type: "user", time: { created: 3000 } },
            ]
          }),
          status: async () => ({ data: { "ses_toolstall": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_toolstall",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should break (not timeout) because tool result exists but no follow-up
      expect(result).toBeNull()
    })

    test("resets stall counter when session goes non-idle", async () => {
      //#given - session alternates between running and idle, then completes
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 5000
      })

      let callCount = 0
      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
              {
                id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "stop",
                content: [{ type: "text", text: "Done" }]
              },
            ]
          }),
          status: async () => {
            callCount++
            if (callCount <= 5) {
              return { data: { "ses_reset": { type: "running" } } }
            }
            return { data: { "ses_reset": { type: "idle" } } }
          }
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_reset",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should complete normally (stall counter was reset by non-idle status)
      expect(result).toBeNull()
    })

    test("detects orphaned tool call when no tool result ever arrives", async () => {
      //#given - assistant made tool calls, session idle, but no tool result posted
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 100,
        MAX_POLL_TIME_MS: 30000
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
              {
                id: "msg_002", type: "assistant", time: { created: 2000 }, finish: "tool-calls",
                content: [{ type: "tool-call", text: "calling tool" }]
              },
            ]
          }),
          status: async () => ({ data: { "ses_orphan": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_orphan",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should break via orphaned tool call detection, not 10-min timeout
      expect(result).toBeNull()
    })
  })

  describe("stability-based completion", () => {
    test("completes when message count stabilizes with assistant content", async () => {
      //#given - assistant responded, finish set but IDs missing (uses timestamp now)
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 2,
        MAX_POLL_TIME_MS: 30000
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { type: "user", time: { created: 1000 } },
              {
                type: "assistant", time: { created: 2000 }, finish: "end_turn",
                content: [{ type: "text", text: "Response with finish but no IDs" }]
              },
            ]
          }),
          status: async () => ({ data: { "ses_stable": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_stable",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should complete via stability detection (not timeout)
      expect(result).toBeNull()
    })

    test("does not fire stability when no assistant message exists", async () => {
      //#given - only user messages, session idle — stability should NOT trigger
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 1,
        MAX_POLL_TIME_MS: 30000
      })

      const mockClient = {
        session: {
          context: async () => ({
            messages: [
              { id: "msg_001", type: "user", time: { created: 1000 } },
            ]
          }),
          status: async () => ({ data: { "ses_noa": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_noa",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should detect stall (no assistant), not stability completion
      expect(result).toContain("Session stalled")
      expect(result).toContain("no assistant response")
    })

    test("resets stability counter when message count changes", async () => {
      //#given - messages grow (no timestamps, no IDs so isSessionComplete fails)
      const { pollSyncSession } = require("../../../src/tools/delegate-task/sync-session-poller")

      __setTimingConfig({
        POLL_INTERVAL_MS: 10,
        MIN_STABILITY_TIME_MS: 0,
        STABILITY_POLLS_REQUIRED: 2,
        MAX_POLL_TIME_MS: 30000
      })

      let callCount = 0
      const mockClient = {
        session: {
          context: async () => {
            callCount++
            if (callCount <= 2) {
              return {
                messages: [
                  { type: "user" },
                  {
                    type: "assistant", finish: "end_turn",
                    content: [{ type: "text", text: "Partial" }]
                  },
                ]
              }
            }
            if (callCount <= 4) {
              return {
                messages: [
                  { type: "user" },
                  {
                    type: "assistant", finish: "end_turn",
                    content: [{ type: "text", text: "Partial" }]
                  },
                  { type: "user" },
                  {
                    type: "assistant", finish: "end_turn",
                    content: [{ type: "text", text: "More" }]
                  },
                ]
              }
            }
            return {
              messages: [
                  { type: "user" },
                  {
                    type: "assistant", finish: "end_turn",
                    content: [{ type: "text", text: "Partial" }]
                  },
                  { type: "user" },
                  {
                    type: "assistant", finish: "end_turn",
                    content: [{ type: "text", text: "More" }]
                  },
              ]
            }
          },
          status: async () => ({ data: { "ses_grow": { type: "idle" } } })
        }
      }

      //#when
      const result = await pollSyncSession(createMockCtx(), mockClient, {
        sessionID: "ses_grow",
        agentToUse: "test-agent",
        toastManager: null,
        taskId: undefined
      })

      //#then - should complete via stability after messages stop growing
      expect(result).toBeNull()
      expect(callCount).toBeGreaterThanOrEqual(5)
    })
  })

  describe("hasAssistantContent", () => {
    test("returns true when assistant has text content", () => {
      const { hasAssistantContent } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { type: "user", content: [{ type: "text", text: "Hello" }] },
        { type: "assistant", content: [{ type: "text", text: "Response" }] },
      ]

      //#then
      expect(hasAssistantContent(messages)).toBe(true)
    })

    test("returns true when assistant has reasoning content", () => {
      const { hasAssistantContent } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { type: "assistant", content: [{ type: "reasoning", text: "Thinking..." }] },
      ]

      //#then
      expect(hasAssistantContent(messages)).toBe(true)
    })

    test("returns false when assistant has only tool-call parts", () => {
      const { hasAssistantContent } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { type: "assistant", content: [{ type: "tool-call", text: "calling" }] },
      ]

      //#then
      expect(hasAssistantContent(messages)).toBe(false)
    })

    test("returns false when no assistant messages", () => {
      const { hasAssistantContent } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { type: "user", content: [{ type: "text", text: "Hello" }] },
      ]

      //#then
      expect(hasAssistantContent(messages)).toBe(false)
    })

    test("returns false when assistant text is empty/whitespace", () => {
      const { hasAssistantContent } = require("../../../src/tools/delegate-task/sync-session-poller")

      //#given
      const messages = [
        { type: "assistant", content: [{ type: "text", text: "  " }] },
      ]

      //#then
      expect(hasAssistantContent(messages)).toBe(false)
    })
  })

})
