/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Isolated module mocks (mirrors sync-task.timeout.test.ts): this file must not
// depend on the real session-state/toast/logger modules, which other files in a
// combined `bun test` run replace via mock.module.
const mockUnregisterSubagentSession = mock(() => {})
const mockRegisterSubagentSession = mock(() => {})

mock.module("../../../src/features/session-state/state", () => ({
  registerSubagentSession: mockRegisterSubagentSession,
  unregisterSubagentSession: mockUnregisterSubagentSession
}))

mock.module("../../../src/features/task-toast-manager", () => ({
  getTaskToastManager: mock(() => null)
}))

mock.module("../../../src/features/tool-metadata-store", () => ({
  storeToolMetadata: mock(() => {})
}))

mock.module("../../../src/shared/logger", () => ({
  log: mock(() => {})
}))

import type { ExecutorContext, ParentContext } from "../../../src/tools/delegate-task/executor-types"
// Import after mocks
import { executeSyncTask } from "../../../src/tools/delegate-task/sync-task"
import type { SyncTaskDeps } from "../../../src/tools/delegate-task/sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../../../src/tools/delegate-task/types"

const SESSION_ID = "ses_retry_12345678"

const defaultArgs: DelegateTaskArgs = {
  description: "test task",
  prompt: "do something",
  run_in_background: false,
  load_skills: []
}

function buildHarness(messagesImpl: () => Promise<unknown>) {
  //#given - mock client whose session.messages answers with the scripted payload
  const mockAbort = mock(() => Promise.resolve())
  const mockMessages = mock(messagesImpl)
  const client = {
    session: {
      interrupt: mockAbort,
      status: mock(() => Promise.resolve({})),
      context: mockMessages
    },
    config: { get: mock(() => Promise.resolve({})) }
  }

  const ctx = {
    sessionID: "parent-session",
    callID: "call-1",
    metadata: mock(() => Promise.resolve()),
    abort: {}
  } as unknown as ToolContextWithMetadata

  const executorCtx = {
    client,
    directory: "/tmp",
    manager: {
      getTasksByParentSession: mock(() => []),
      hasInFlightNotificationForParent: mock(() => false)
    },
    onSyncSessionCreated: undefined
  } as unknown as ExecutorContext

  const parentContext = {
    sessionID: "parent-session",
    messageID: "msg-1"
  } as ParentContext

  const sendSyncPrompt = mock(() => Promise.resolve(null))
  const pollSyncSession = mock(() => Promise.resolve(null))
  const fetchSyncResult = mock(() => Promise.resolve({ ok: true as const, textContent: "completed" }))
  const deps = {
    createSyncSession: mock(() =>
      Promise.resolve({ ok: true as const, sessionID: SESSION_ID, parentDirectory: "/tmp" }),
    ),
    sendSyncPrompt,
    pollSyncSession,
    fetchSyncResult
  } as unknown as SyncTaskDeps & {
    sendSyncPrompt: ReturnType<typeof mock>
    pollSyncSession: ReturnType<typeof mock>
    fetchSyncResult: ReturnType<typeof mock>
  }

  return { ctx, executorCtx, parentContext, deps, sendSyncPrompt, pollSyncSession, fetchSyncResult, mockMessages, mockAbort }
}

describe("executeSyncTask - retry-once-on-empty", () => {
  const { __setTimingConfig, __resetTimingConfig } = require("../../../src/tools/delegate-task/timing")
  const { __setEmptyRetryBackoffMs, __resetEmptyRetryBackoffMs } = require("../../../src/tools/delegate-task/sync-empty-retry")

  beforeEach(() => {
    //#given - shrink timing + retry backoff so the retry path stays quick
    __setTimingConfig({ MAX_POLL_TIME_MS: 60, POLL_INTERVAL_MS: 5 })
    __setEmptyRetryBackoffMs(5)
    mockRegisterSubagentSession.mockClear()
    mockUnregisterSubagentSession.mockClear()
  })

  afterEach(() => {
    //#given - reset timing + backoff after each test
    __resetTimingConfig()
    __resetEmptyRetryBackoffMs()
  })

  test("(A) success but 0 messages -> exactly 1 retry happens, then structured error", async () => {
    //#given - pipeline reports success (null promptError) but the session stays empty
    const h = buildHarness(async () => ({ messages: [] }))

    //#when
    const result = await executeSyncTask(
      defaultArgs, h.ctx, h.executorCtx, h.parentContext,
      "mouse", undefined, undefined, undefined, h.deps,
    )

    //#then - exactly one retry: send+poll each ran twice, session re-checked twice
    expect(h.sendSyncPrompt).toHaveBeenCalledTimes(2)
    expect(h.pollSyncSession).toHaveBeenCalledTimes(2)
    expect(h.mockMessages).toHaveBeenCalledTimes(2)
    //#then - structured error through the promptError channel: never null, never empty
    expect(result).not.toBeNull()
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain(SESSION_ID)
    expect(result).toContain("Send+poll sync task")
    expect(h.fetchSyncResult).not.toHaveBeenCalled()
  })

  test("(B) success with >=1 messages -> NO retry", async () => {
    //#given - session has a user + assistant message, so no empty-response retry is needed
    const h = buildHarness(async () => ({
      messages: [
        { id: "msg_001", type: "user", time: { created: 1000 } },
        {
          id: "msg_002", type: "assistant", time: { created: 2000 },
          content: [{ type: "text", text: "Hello" }]
        },
      ]
    }))

    //#when
    const result = await executeSyncTask(
      defaultArgs, h.ctx, h.executorCtx, h.parentContext,
      "mouse", undefined, undefined, undefined, h.deps,
    )

    //#then - single send+poll pass, normal completion
    expect(h.sendSyncPrompt).toHaveBeenCalledTimes(1)
    expect(h.pollSyncSession).toHaveBeenCalledTimes(1)
    expect(result).toContain("Task completed")
  })

  test("(C) already-retried (second consecutive empty) -> no second retry", async () => {
    //#given - session stays empty across both attempts
    const h = buildHarness(async () => ({ messages: [] }))

    //#when
    const result = await executeSyncTask(
      defaultArgs, h.ctx, h.executorCtx, h.parentContext,
      "mouse", undefined, undefined, undefined, h.deps,
    )

    //#then - retry budget capped at 1: no third send, no third poll, no third check
    expect(h.sendSyncPrompt).toHaveBeenCalledTimes(2)
    expect(h.pollSyncSession).toHaveBeenCalledTimes(2)
    expect(h.mockMessages).toHaveBeenCalledTimes(2)
    //#then - the double-empty still surfaces a structured error, not a silent noop
    expect(result).not.toBeNull()
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain(SESSION_ID)
  })
})
