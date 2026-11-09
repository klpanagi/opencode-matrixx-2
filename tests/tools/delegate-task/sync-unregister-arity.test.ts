/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import * as stateModule from "../../../src/features/session-state/state"

const subagentSessions = stateModule.subagentSessions
const resetSessionState = stateModule._resetForTesting

mock.module("../../../src/features/session-state/state", () => ({
  ...stateModule,
  unregisterSubagentSession: (...ids: string[]) => {
    for (const id of ids) subagentSessions.delete(id)
  },
}))

import type { ExecutorContext, ParentContext } from "../../../src/tools/delegate-task/executor-types"
import { executeSyncTask } from "../../../src/tools/delegate-task/sync-task"
import type { SyncTaskDeps } from "../../../src/tools/delegate-task/sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../../../src/tools/delegate-task/types"

const SESSION_ID = "ses_arity_12345678"
const PARENT_ID = "parent-session"

const defaultArgs: DelegateTaskArgs = {
  description: "test task",
  prompt: "do something",
  run_in_background: false,
  load_skills: [],
}

interface HarnessOverrides {
  unregister?: ((sessionID: string) => void) | undefined
}

function buildHarness(overrides: HarnessOverrides = {}) {
  //#given - successful sync pipeline
  const client = {
    session: {
      interrupt: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({})),
      context: mock(() => Promise.resolve({ messages: [] })),
    },
    config: { get: mock(() => Promise.resolve({})) },
  }

  const ctx = {
    sessionID: PARENT_ID,
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

  const parentContext: ParentContext = { sessionID: PARENT_ID, messageID: "msg-1" }

  const deps: SyncTaskDeps = {
    createSyncSession: mock(() =>
      Promise.resolve({ ok: true as const, sessionID: SESSION_ID }),
    ),
    sendSyncPrompt: mock(() => Promise.resolve(null)),
    pollSyncSession: mock(() => Promise.resolve(null)),
    fetchSyncResult: mock(() => Promise.resolve({ ok: true as const, textContent: "done" })),
    ...(overrides.unregister !== undefined ? { unregister: overrides.unregister } : {}),
  }

  return { ctx, executorCtx, parentContext, deps }
}

async function runSyncTask(overrides: HarnessOverrides = {}) {
  const h = buildHarness(overrides)
  await executeSyncTask(
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
}

describe("executeSyncTask - unregister arity", () => {
  let deleteSpy: ReturnType<typeof spyOn<typeof subagentSessions, "delete">>
  const { __setTimingConfig, __resetTimingConfig } = require("../../../src/tools/delegate-task/timing")
  const { __setEmptyRetryBackoffMs, __resetEmptyRetryBackoffMs } = require("../../../src/tools/delegate-task/sync-empty-retry")

  beforeEach(() => {
    //#given - fast timing, clean registry, and a spy on the observable Set.delete
    __setTimingConfig({ POLL_INTERVAL_MS: 5, MIN_STABILITY_TIME_MS: 0, STABILITY_POLLS_REQUIRED: 1, MAX_POLL_TIME_MS: 100 })
    __setEmptyRetryBackoffMs(5)
    resetSessionState()
    deleteSpy = spyOn(subagentSessions, "delete")
  })

  afterEach(() => {
    //#given - restore the spy, timing, and registry between cases
    deleteSpy.mockRestore()
    __resetTimingConfig()
    __resetEmptyRetryBackoffMs()
    resetSessionState()
  })

  test("default module hook removes the session exactly once", async () => {
    //#given - no injected hook (production fallback path)
    //#when
    await runSyncTask()

    //#then - exactly one delete, no residue
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(SESSION_ID)
    expect(stateModule.hasSubagentSession(SESSION_ID)).toBe(false)
  })

  test("injected single-arg callback removes the session exactly once", async () => {
    //#given - an injected callback that performs the real removal
    const injected = (sessionID: string) => {
      subagentSessions.delete(sessionID)
    }

    //#when
    await runSyncTask({ unregister: injected })

    //#then - one delete, no residue
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(SESSION_ID)
    expect(stateModule.hasSubagentSession(SESSION_ID)).toBe(false)
  })

  test("zero-arg stub unregister still removes the session exactly once via backstop", async () => {
    //#given - a stub that cannot clean up (Function.length === 0)
    const stub = mock(() => {})

    //#when
    await runSyncTask({ unregister: stub })

    //#then - the observable hook ran once and the registry has no residue
    expect(stub).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(SESSION_ID)
    expect(stateModule.hasSubagentSession(SESSION_ID)).toBe(false)
  })

  test("rest-args unregister with length 0 does not double-delete", async () => {
    //#given - a rest-args implementation (length 0) that actually deletes
    const restUnregister = (...ids: string[]) => {
      for (const id of ids) subagentSessions.delete(id)
    }
    expect(restUnregister.length).toBe(0)

    //#when
    await runSyncTask({ unregister: restUnregister })

    //#then - exactly one delete; the old arity sniff deleted twice
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(SESSION_ID)
    expect(stateModule.hasSubagentSession(SESSION_ID)).toBe(false)
  })
})
