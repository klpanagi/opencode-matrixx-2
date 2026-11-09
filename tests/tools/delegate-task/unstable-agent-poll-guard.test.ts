/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { resolveCategoryExecution } from "../../../src/tools/delegate-task/category-resolver"
import type { DelegateTaskArgs, ExecutorContext } from "../../../src/tools/delegate-task/executor-types"
import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"
import { executeUnstableAgentTask } from "../../../src/tools/delegate-task/unstable-agent-task"
import {
  _resetForTesting as resetSessionState,
  registerSubagentSession,
} from "../../../src/features/session-state/state"
import * as connectedProvidersCache from "../../../src/shared/model/connected-providers-cache"
import type { MatrixxConfig } from "../../../src/config"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createContinuationHooks } from "../../../src/plugin/hooks/create-continuation-hooks"
import type { NativePluginContext } from "../../../src/shared/session/session-context-source"

const ARGS: DelegateTaskArgs = {
  prompt: "test prompt",
  description: "test task",
  category: "test",
  load_skills: [],
  run_in_background: false,
}

const PARENT_CONTEXT = { sessionID: "parent-session", messageID: "msg-123" }

function makeCtx() {
  return {
    sessionID: "parent-session",
    messageID: "msg-123",
    agent: "morpheus",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

function makeMessages(sessionID: string) {
  return [
    { type: "user", id: "m1", content: [{ type: "text", text: "hello" }] },
    {
      type: "assistant",
      id: "m2",
      time: { created: Date.now() },
      content: [{ type: "text", text: `result for ${sessionID}` }],
    },
  ]
}

function makeExecutor(options: {
  sessionID: string
  status?: string
  error?: string
}) {
  const { sessionID, status = "running", error } = options
  const task = { id: "bg_guard", sessionID, status, description: "guarded task", prompt: "p", agent: "mouse", error }
  const client = {
    session: {
      context: async ({ sessionID: requested }: { sessionID: string }) => ({
        messages: makeMessages(requested),
      }),
    },
  }
  return {
    manager: {
      launch: async () => ({ ...task }),
      getTask: () => ({ ...task }),
    },
    client,
    directory: "/tmp",
  } as unknown as ExecutorContext
}

describe("executeUnstableAgentTask poll guard", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 5,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 500,
      WAIT_FOR_SESSION_TIMEOUT_MS: 100,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
    })
  })

  afterEach(() => {
    resetSessionState()
    __resetTimingConfig()
  })

  test("does not report success while a delegated child session is still active", async () => {
    //#given - the monitored session has a live child delegation registered
    const sessionID = "ses_guard_active_child"
    registerSubagentSession("ses_grandchild", sessionID)
    __setTimingConfig({ MAX_POLL_TIME_MS: 40 })
    const executorCtx = makeExecutor({ sessionID })

    //#when
    const result = await executeUnstableAgentTask(
      ARGS,
      makeCtx(),
      executorCtx,
      PARENT_CONTEXT,
      "test-agent",
      undefined,
      undefined,
      "test-model",
    )

    //#then - success is withheld; the outcome reports the session still running
    expect(result).not.toContain("SUPERVISED TASK COMPLETED SUCCESSFULLY")
    expect(result).toContain("Status: running")
  })

  test("uses the configured session-start timeout instead of a hardcoded 30s literal", async () => {
    //#given - a task that never gets a session, with a distinctive configured timeout
    __setTimingConfig({ WAIT_FOR_SESSION_TIMEOUT_MS: 120, WAIT_FOR_SESSION_INTERVAL_MS: 5 })
    const task = { id: "bg_no_session", status: "running", description: "no session", prompt: "p", agent: "mouse" }
    const executorCtx = {
      manager: { launch: async () => ({ ...task }), getTask: () => ({ ...task }) },
      client: { session: { context: async () => ({ messages: [] }) } },
      directory: "/tmp",
    } as unknown as ExecutorContext

    //#when
    const result = await executeUnstableAgentTask(
      ARGS,
      makeCtx(),
      executorCtx,
      PARENT_CONTEXT,
      "test-agent",
      undefined,
      undefined,
      "test-model",
    )

    //#then - the configured timeout is reflected and the 30s literal is gone
    expect(result).toContain("120ms")
    expect(result).not.toContain("(30s)")
  })

  test("completes normally when no child delegations are active", async () => {
    //#given - no live child sessions registered
    const executorCtx = makeExecutor({ sessionID: "ses_guard_no_child" })

    //#when
    const result = await executeUnstableAgentTask(
      ARGS,
      makeCtx(),
      executorCtx,
      PARENT_CONTEXT,
      "test-agent",
      undefined,
      undefined,
      "test-model",
    )

    //#then
    expect(result).toContain("SUPERVISED TASK COMPLETED SUCCESSFULLY")
  })
})

describe("isUnstableAgent retention (D7 port from deleted babysitter hook test)", () => {
  let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
  let providerModelsSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    //#given - deterministic provider cache so category resolution is offline
    connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
  })

  afterEach(() => {
    connectedProvidersSpy?.mockRestore()
    providerModelsSpy?.mockRestore()
  })

  test("gemini models still resolve as unstable agents", async () => {
    //#given
    const executorCtx = {
      client: {},
      manager: {},
      directory: "/tmp",
      userCategories: { "gemini-cat": { model: "google/gemini-1.5-pro" } },
    } as unknown as ExecutorContext
    const args: DelegateTaskArgs = { ...ARGS, category: "gemini-cat" }

    //#when
    const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

    //#then
    expect(result.isUnstableAgent).toBe(true)
  })

  test("stable models do not resolve as unstable agents", async () => {
    //#given
    const executorCtx = {
      client: {},
      manager: {},
      directory: "/tmp",
      userCategories: { "stable-cat": { model: "anthropic/claude-sonnet-4-6" } },
    } as unknown as ExecutorContext
    const args: DelegateTaskArgs = { ...ARGS, category: "stable-cat" }

    //#when
    const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

    //#then
    expect(result.isUnstableAgent).toBe(false)
  })
})

describe("continuation hooks smoke", () => {
  test("the unwired babysitter leaves no slot on the continuation hooks object", () => {
    //#given headless continuation wiring with every hook disabled
    const hooks = createContinuationHooks({
      ctx: {} as NativePluginContext,
      pluginConfig: {} as MatrixxConfig,
      isHookEnabled: () => false,
      safeHookEnabled: false,
      backgroundManager: {} as BackgroundManager,
      sessionRecovery: {} as never,
    })

    //#when the returned wiring is inspected
    //#then the removed hook has no property
    expect("unstableAgentBabysitter" in hooks).toBe(false)
  })
})
