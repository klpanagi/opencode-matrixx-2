/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EffortConfig } from "../../../src/config/schema/effort"
import type { ExecutorContext, ParentContext } from "../../../src/tools/delegate-task/executor-types"
import { executeSyncTask } from "../../../src/tools/delegate-task/sync-task"
import type { SyncTaskDeps } from "../../../src/tools/delegate-task/sync-task-deps"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "../../../src/tools/delegate-task/types"
import { getTaskDir, readJsonSafe, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import { type Task, TaskSchema } from "../../../src/features/task-storage/types"

const CONFIG: EffortConfig = {
  enabled: true,
  report: ["parent"],
  weights: { compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 },
  prices: {
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheWritePer1k: 0.00375,
  },
  toolCosts: {},
  maxMessages: 200,
  maxBytes: 2_097_152,
  rollup: false,
}

type MetadataPayload = { title?: string; metadata?: Record<string, unknown> }

function assistantMessage(): Record<string, unknown> {
  return {
    type: "assistant",
    info: {
      role: "assistant",
      tokens: {
        input: 10,
        output: 20,
        reasoning: 0,
        cache: { read: 3, write: 4 },
      },
    },
    content: [{ type: "tool", tool: "read" }],
  }
}

const SESSION_ID = "ses_sync_effort"

function buildClient(contextImpl: () => Promise<unknown>) {
  return {
    session: {
      create: async () => ({ id: SESSION_ID }),
      interrupt: async () => ({}),
      context: contextImpl,
    },
  }
}

function buildDeps(): SyncTaskDeps {
  return {
    createSyncSession: async () => ({
      ok: true as const,
      sessionID: SESSION_ID,
    }),
    sendSyncPrompt: async () => null,
    pollSyncSession: async () => null,
    fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
  } as unknown as SyncTaskDeps
}

function buildArgs(): DelegateTaskArgs {
  return {
    description: "sync effort task",
    prompt: "test prompt",
    category: "test",
    load_skills: [],
    run_in_background: false,
  }
}

function buildParentContext(): ParentContext {
  return { sessionID: "parent-session", messageID: "msg_parent" }
}

describe("agent-effort wiring: foreground sync path", () => {
  let dir: string

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "effort-sync-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("successful sync task re-emits metadata carrying the effort record", async () => {
    //#given
    const metadataCalls: MetadataPayload[] = []
    const ctx = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async (payload: MetadataPayload) => {
        metadataCalls.push(payload)
      },
    } as unknown as ToolContextWithMetadata
    const executorCtx = {
      client: buildClient(async () => [assistantMessage()]),
      directory: dir,
      onSyncSessionCreated: null,
      effortConfig: CONFIG,
    } as unknown as ExecutorContext

    //#when
    const result = await executeSyncTask(
      buildArgs(),
      ctx,
      executorCtx,
      buildParentContext(),
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )

    //#then
    expect(result.startsWith("Task completed in")).toBe(true)
    expect(result).toContain("done")
    expect(metadataCalls.length).toBeGreaterThanOrEqual(2)
    expect(metadataCalls[0].metadata?.effort).toBeUndefined()
    expect(metadataCalls[metadataCalls.length - 1].metadata?.effort).toBeDefined()
  })

  test("attaches effort to the parent session's single active task", async () => {
    //#given
    const parentContext = buildParentContext()
    const parentTask: Task = {
      id: "T-sync-parent",
      subject: "Sync parent task",
      description: "Task that should receive the delegated run's effort",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      generation: 1,
      threadID: parentContext.sessionID,
    }
    const taskPath = join(getTaskDir({}, dir), `${parentTask.id}.json`)
    writeJsonAtomic(taskPath, parentTask)
    const ctx = {
      sessionID: parentContext.sessionID,
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async () => {},
    } as unknown as ToolContextWithMetadata
    const executorCtx = {
      client: buildClient(async () => [assistantMessage()]),
      directory: dir,
      onSyncSessionCreated: null,
      effortConfig: CONFIG,
    } as unknown as ExecutorContext

    //#when
    const result = await executeSyncTask(
      buildArgs(),
      ctx,
      executorCtx,
      parentContext,
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )

    //#then
    expect(result.startsWith("Task completed in")).toBe(true)
    expect(result).toContain("done")
    const persisted = readJsonSafe(taskPath, TaskSchema)
    expect(persisted?.metadata?.effort).toBeDefined()
  })

  test("without effort config the return contract is unchanged and no effort metadata is emitted", async () => {
    //#given
    const metadataCalls: MetadataPayload[] = []
    const ctx = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async (payload: MetadataPayload) => {
        metadataCalls.push(payload)
      },
    } as unknown as ToolContextWithMetadata
    const executorCtx = {
      client: buildClient(async () => [assistantMessage()]),
      directory: dir,
      onSyncSessionCreated: null,
    } as unknown as ExecutorContext

    //#when
    const result = await executeSyncTask(
      buildArgs(),
      ctx,
      executorCtx,
      buildParentContext(),
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )

    //#then
    expect(result.startsWith("Task completed in")).toBe(true)
    expect(result).toContain("done")
    expect(metadataCalls.every((call) => call.metadata?.effort === undefined)).toBe(true)
  })

  test("fails open when the effort collector rejects", async () => {
    //#given
    const ctx = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async () => {},
    } as unknown as ToolContextWithMetadata
    const executorCtx = {
      client: buildClient(async () => {
        throw new Error("context unavailable")
      }),
      directory: dir,
      onSyncSessionCreated: null,
      effortConfig: CONFIG,
    } as unknown as ExecutorContext

    //#when
    const result = await executeSyncTask(
      buildArgs(),
      ctx,
      executorCtx,
      buildParentContext(),
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )

    //#then
    expect(result.startsWith("Task completed in")).toBe(true)
    expect(result).toContain("done")
  })

  test("collector failure does not alter the exact returned string", async () => {
    //#given
    const okCtx = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async () => {},
    } as unknown as ToolContextWithMetadata
    const okExecutorCtx = {
      client: buildClient(async () => [assistantMessage()]),
      directory: dir,
      onSyncSessionCreated: null,
      effortConfig: CONFIG,
    } as unknown as ExecutorContext
    const failCtx = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: new AbortController().signal,
      metadata: async () => {},
    } as unknown as ToolContextWithMetadata
    const failExecutorCtx = {
      client: buildClient(async () => {
        throw new Error("context unavailable")
      }),
      directory: dir,
      onSyncSessionCreated: null,
      effortConfig: CONFIG,
    } as unknown as ExecutorContext

    //#when
    const okResult = await executeSyncTask(
      buildArgs(),
      okCtx,
      okExecutorCtx,
      buildParentContext(),
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )
    const failResult = await executeSyncTask(
      buildArgs(),
      failCtx,
      failExecutorCtx,
      buildParentContext(),
      "test-agent",
      undefined,
      undefined,
      undefined,
      buildDeps(),
    )

    //#then
    expect(failResult).toBe(okResult)
  })
})
