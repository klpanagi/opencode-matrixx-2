/// <reference types="bun-types" />
/**
 * T-21 — fail-open guard behaviour (D1).
 *
 * A transport error must never block a completion: `validateSessionHasOutput`
 * returns true. The sync path keeps exactly one retry when the session has no
 * assistant/tool output.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { validateSessionHasOutput } from "../../../src/features/background-agent/manager/output-guard"
import type { ExecutorContext, ParentContext } from "../../../src/tools/delegate-task/executor-types"
import { executeSyncTask } from "../../../src/tools/delegate-task/sync-task"
import type { SyncTaskDeps } from "../../../src/tools/delegate-task/sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../../../src/tools/delegate-task/types"

const SESSION_ID = "ses_guard_sync_12345678"

const defaultArgs: DelegateTaskArgs = {
  description: "test task",
  prompt: "do something",
  run_in_background: false,
  load_skills: [],
}

function buildSyncHarness(contextImpl: () => Promise<unknown>) {
  //#given a sync executor whose session context is scripted per call
  const context = mock(contextImpl)
  const client = {
    session: {
      interrupt: mock(() => Promise.resolve()),
      context,
    },
    config: { get: mock(() => Promise.resolve({})) },
  }

  const ctx = {
    sessionID: "parent-session",
    callID: "call-1",
    metadata: mock(() => Promise.resolve()),
    abort: {},
  } as unknown as ToolContextWithMetadata

  const executorCtx = {
    client,
    directory: "/tmp",
    manager: {
      getTasksByParentSession: mock(() => []),
      hasInFlightNotificationForParent: mock(() => false),
    },
    onSyncSessionCreated: undefined,
  } as unknown as ExecutorContext

  const parentContext = {
    sessionID: "parent-session",
    messageID: "msg-1",
  } as ParentContext

  const sendSyncPrompt = mock(() => Promise.resolve(null))
  const pollSyncSession = mock(() => Promise.resolve(null))
  const fetchSyncResult = mock(() => Promise.resolve({ ok: true as const, textContent: "completed" }))
  const deps = {
    createSyncSession: mock(() =>
      Promise.resolve({ ok: true as const, sessionID: SESSION_ID }),
    ),
    sendSyncPrompt,
    pollSyncSession,
    fetchSyncResult,
  } as unknown as SyncTaskDeps

  return { ctx, executorCtx, parentContext, deps, sendSyncPrompt, pollSyncSession, context }
}

describe("validateSessionHasOutput fail-open", () => {
  test("transport error returns true", async () => {
    //#given a client whose session context rejects
    const client = {
      session: {
        context: async () => {
          throw new Error("transport down")
        },
      },
    }

    //#when the guard validates the session
    const result = await validateSessionHasOutput(client, "ses_transport")

    //#then a flaky lookup cannot block the existing completion path
    expect(result).toBe(true)
  })

  test("zero messages returns false", async () => {
    //#given a client whose session context answers with no messages
    const client = { session: { context: async () => ({ messages: [] }) } }

    //#when the guard validates the session
    const result = await validateSessionHasOutput(client, "ses_empty")

    //#then only a genuinely empty session is incomplete
    expect(result).toBe(false)
  })
})

describe("sync path retry-once uses the output guard", () => {
  const { __setTimingConfig, __resetTimingConfig } = require("../../../src/tools/delegate-task/timing")
  const { __setEmptyRetryBackoffMs, __resetEmptyRetryBackoffMs } = require("../../../src/tools/delegate-task/sync-empty-retry")
  const { _resetTaskToastManagerForTesting } = require("../../../src/features/task-toast-manager/manager")

  beforeEach(() => {
    //#given fast timing and a clean toast singleton
    __setTimingConfig({ MAX_POLL_TIME_MS: 60, POLL_INTERVAL_MS: 5 })
    __setEmptyRetryBackoffMs(0)
    _resetTaskToastManagerForTesting()
  })

  test("empty then empty: exactly one retry, then the structured error", async () => {
    //#given a session that never produces output
    const h = buildSyncHarness(async () => ({ messages: [] }))

    //#when the sync task runs
    const result = await executeSyncTask(
      defaultArgs,
      h.ctx,
      h.executorCtx,
      h.parentContext,
      "mouse",
      undefined,
      undefined,
      undefined,
      h.deps,
    )

    //#then exactly one retry happened and the structured error is surfaced
    expect(h.sendSyncPrompt).toHaveBeenCalledTimes(2)
    expect(h.pollSyncSession).toHaveBeenCalledTimes(2)
    expect(h.context).toHaveBeenCalledTimes(2)
    expect(typeof result).toBe("string")
    expect(result).toContain(SESSION_ID)
    expect(result).toContain("Send+poll sync task")
  })

  test("empty then output: retry succeeds without a second retry", async () => {
    //#given a session that emits assistant text on the retry
    let call = 0
    const h = buildSyncHarness(async () => {
      call += 1
      if (call === 1) return { messages: [] }
      return { messages: [{ type: "assistant", content: [{ type: "text", text: "finished" }] }] }
    })

    //#when the sync task runs
    const result = await executeSyncTask(
      defaultArgs,
      h.ctx,
      h.executorCtx,
      h.parentContext,
      "mouse",
      undefined,
      undefined,
      undefined,
      h.deps,
    )

    //#then the retry produced a normal completion
    expect(h.sendSyncPrompt).toHaveBeenCalledTimes(2)
    expect(h.pollSyncSession).toHaveBeenCalledTimes(2)
    expect(h.context).toHaveBeenCalledTimes(2)
    expect(result).toContain("Task completed")
  })
})
