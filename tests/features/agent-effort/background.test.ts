import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BackgroundEffortRuntime,
  type BackgroundEffortTask,
  recordEffortForBackground,
} from "../../../src/features/agent-effort/background"
import { DEFAULT_PRICES, DEFAULT_WEIGHTS } from "../../../src/features/agent-effort/constants"
import type { EffortConfig } from "../../../src/features/agent-effort/types"
import { getTaskDir, readJsonSafe, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import { type Task, TaskSchema } from "../../../src/features/task-storage/types"

const SESSION_ID = "ses_effort_test"

function makeConfig(overrides: Partial<EffortConfig> = {}): EffortConfig {
  return {
    enabled: true,
    report: ["parent"],
    weights: DEFAULT_WEIGHTS,
    prices: DEFAULT_PRICES,
    toolCosts: {},
    maxMessages: 200,
    maxBytes: 2_097_152,
    rollup: false,
    ...overrides,
  }
}

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

function makeRuntime(
  directory: string,
  contextImpl: BackgroundEffortRuntime["native"]["session"]["context"] = async () => [
    assistantMessage(),
  ],
): BackgroundEffortRuntime {
  return { native: { session: { context: contextImpl } }, directory }
}

function makeTask(id: string, sessionID: string | undefined = SESSION_ID): BackgroundEffortTask {
  return {
    id,
    sessionID,
    startedAt: new Date("2026-11-08T00:00:00.000Z"),
    completedAt: new Date("2026-11-08T00:00:02.000Z"),
  }
}

function makeStoredTask(id: string, threadID: string): Task {
  return {
    id,
    subject: "Background effort task",
    description: "Task used to verify effort persistence",
    status: "pending",
    blocks: [],
    blockedBy: [],
    generation: 2,
    threadID,
  }
}

describe("recordEffortForBackground", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "matrixx-bg-effort-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns null without reading messages when config is disabled", async () => {
    //#given
    let contextCalls = 0
    const runtime = makeRuntime(directory, async () => {
      contextCalls += 1
      return [assistantMessage()]
    })

    //#when
    const result = await recordEffortForBackground(runtime, makeTask("bg_disabled"), makeConfig({ enabled: false }))

    //#then
    expect(result).toBeNull()
    expect(contextCalls).toBe(0)
  })

  test("returns null when the task has no sessionID", async () => {
    //#given
    let contextCalls = 0
    const runtime = makeRuntime(directory, async () => {
      contextCalls += 1
      return [assistantMessage()]
    })

    //#when
    const result = await recordEffortForBackground(runtime, { id: "bg_no_session" }, makeConfig())

    //#then
    expect(result).toBeNull()
    expect(contextCalls).toBe(0)
  })

  test("computes a record and formatted line from session messages", async () => {
    //#given
    const runtime = makeRuntime(directory)

    //#when
    const result = await recordEffortForBackground(runtime, makeTask("bg_happy"), makeConfig())

    //#then
    expect(result).not.toBeNull()
    expect(result?.record.formulaVersion).toBe(1)
    expect(result?.record.telemetry.input).toBe(10)
    expect(result?.record.telemetry.output).toBe(20)
    expect(result?.record.telemetry.toolCalls).toBe(1)
    expect(result?.record.telemetry.durationMs).toBe(2000)
    expect(result?.line).toMatch(/^⚡ effort /)
  })

  test("persists the record onto the matching task file", async () => {
    //#given
    const stored = makeStoredTask("T-effort-bg", SESSION_ID)
    const taskPath = join(getTaskDir({}, directory), `${stored.id}.json`)
    writeJsonAtomic(taskPath, stored)
    const runtime = makeRuntime(directory)

    //#when
    await recordEffortForBackground(runtime, makeTask(stored.id), makeConfig())

    //#then
    const persisted = readJsonSafe(taskPath, TaskSchema)
    const effort = (persisted?.metadata?.effort ?? {}) as Record<string, unknown>
    expect(effort.total).toBeTypeOf("number")
    expect(persisted?.metadata?.effort).toBeDefined()
  })

  test("attaches effort to the parent session's single active task via parentSessionID", async () => {
    //#given
    const parentSessionID = "ses_bg_parent"
    const parentTask: Task = {
      id: "T-bg-parent",
      subject: "Parent background task",
      description: "Task that should receive the delegated run's effort",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      generation: 1,
      threadID: parentSessionID,
    }
    const taskPath = join(getTaskDir({}, directory), `${parentTask.id}.json`)
    writeJsonAtomic(taskPath, parentTask)
    const runtime = makeRuntime(directory)

    //#when
    await recordEffortForBackground(
      runtime,
      { ...makeTask("bg_child"), parentSessionID },
      makeConfig(),
    )

    //#then
    const persisted = readJsonSafe(taskPath, TaskSchema)
    const effort = (persisted?.metadata?.effort ?? {}) as Record<string, unknown>
    expect(effort.total).toBeTypeOf("number")
  })

  test("fails open when the session context rejects", async () => {
    //#given
    const runtime = makeRuntime(directory, async () => {
      throw new Error("context unavailable")
    })

    //#when
    const result = await recordEffortForBackground(runtime, makeTask("bg_reject"), makeConfig())

    //#then
    expect(result).toBeNull()
  })

  test("still computes and persists when reporting is off, without capturing a parent line", async () => {
    //#given
    const stored = makeStoredTask("T-effort-off", SESSION_ID)
    const taskPath = join(getTaskDir({}, directory), `${stored.id}.json`)
    writeJsonAtomic(taskPath, stored)
    const runtime = makeRuntime(directory)

    //#when
    const result = await recordEffortForBackground(
      runtime,
      makeTask(stored.id),
      makeConfig({ report: ["off"] }),
    )

    //#then
    expect(result).not.toBeNull()
    expect(result?.line).toMatch(/^⚡ effort /)
    const persisted = readJsonSafe(taskPath, TaskSchema)
    expect((persisted?.metadata?.effort ?? {}) as Record<string, unknown>).toHaveProperty("total")
  })
})
