/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { recordEffortForForeground } from "../../../src/features/agent-effort/foreground"
import type { EffortConfig } from "../../../src/features/agent-effort/types"
import { getTaskDir, readJsonSafe, writeJsonAtomic } from "../../../src/features/task-storage/storage"
import { type Task, TaskSchema } from "../../../src/features/task-storage/types"

function makeConfig(overrides: Partial<EffortConfig> = {}): EffortConfig {
  return {
    enabled: true,
    report: ["parent"],
    weights: { compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 },
    prices: { inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWritePer1k: 0.00375 },
    toolCosts: {},
    maxMessages: 200,
    maxBytes: 2_097_152,
    rollup: false,
    ...overrides,
  }
}

function assistantMessage() {
  return {
    type: "assistant",
    info: {
      role: "assistant",
      tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 2 } },
    },
    content: [{ type: "tool", tool: "read" }],
    time: { created: 1000 },
  }
}

function makeClient(messages: unknown[]) {
  return {
    session: {
      context: async (_input: { sessionID: string }) => messages,
    },
  }
}

function makeTask(id: string, generation = 2): Task {
  return {
    id,
    subject: "Parent task",
    description: "Parent task for effort attachment",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
    generation,
    metadata: { other: "keep-me" },
  }
}

describe("recordEffortForForeground", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "matrixx-foreground-effort-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns null and skips the context call when disabled", async () => {
    //#given
    let contextCalls = 0
    const client = {
      session: {
        context: async (_input: { sessionID: string }) => {
          contextCalls += 1
          return []
        },
      },
    }

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_disabled",
      config: makeConfig({ enabled: false }),
    })

    //#then
    expect(result).toBeNull()
    expect(contextCalls).toBe(0)
  })

  test("computes a record and report line for an assistant session", async () => {
    //#given
    const client = makeClient([assistantMessage()])

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_happy",
      config: makeConfig(),
      startedAt: new Date(1000),
      completedAt: new Date(2500),
    })

    //#then
    expect(result).not.toBeNull()
    expect(result?.record.formulaVersion).toBeGreaterThan(0)
    expect(typeof result?.record.computedAt).toBe("string")
    expect(result?.record.telemetry.input).toBe(100)
    expect(result?.record.telemetry.toolCalls).toBe(1)
    expect(result?.record.telemetry.durationMs).toBe(1500)
    expect(result?.line).toContain("⚡ effort")
    expect(result?.line).toBe(result?.line.trim())
  })

  test("returns a result without throwing when parentID has no task file", async () => {
    //#given
    const client = makeClient([assistantMessage()])

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_no_task",
      config: makeConfig(),
      parentID: "T-does-not-exist",
    })

    //#then
    expect(result).not.toBeNull()
    expect(readJsonSafe(join(getTaskDir({}, directory), "T-does-not-exist.json"), TaskSchema)).toBeNull()
  })

  test("attaches effort to an existing parent task", async () => {
    //#given
    const task = makeTask("T-parent")
    const taskPath = join(getTaskDir({}, directory), `${task.id}.json`)
    writeJsonAtomic(taskPath, task)
    const client = makeClient([assistantMessage()])

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_with_task",
      config: makeConfig(),
      parentID: task.id,
    })

    //#then
    expect(result).not.toBeNull()
    const stored = readJsonSafe(taskPath, TaskSchema)
    expect(stored).not.toBeNull()
    const effort = (stored?.metadata?.effort ?? {}) as Record<string, unknown>
    expect(effort.total).toBe(result?.record.total)
    expect(effort.generation).toBe(task.generation)
    expect(stored?.metadata?.other).toBe("keep-me")
  })

  test("attaches effort through parentSessionID when exactly one task is active", async () => {
    //#given
    const parentSessionID = "ses_foreground_parent"
    const task: Task = {
      ...makeTask("T-session-single"),
      status: "in_progress",
      threadID: parentSessionID,
    }
    const taskPath = join(getTaskDir({}, directory), `${task.id}.json`)
    writeJsonAtomic(taskPath, task)
    const client = makeClient([assistantMessage()])

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_child_run",
      config: makeConfig(),
      parentSessionID,
    })

    //#then
    expect(result).not.toBeNull()
    const stored = readJsonSafe(taskPath, TaskSchema)
    const effort = (stored?.metadata?.effort ?? {}) as Record<string, unknown>
    expect(effort.total).toBe(result?.record.total)
  })

  test("does not attach effort through parentSessionID when two tasks are active", async () => {
    //#given
    const parentSessionID = "ses_foreground_parent_two"
    const first: Task = {
      ...makeTask("T-session-a"),
      status: "in_progress",
      threadID: parentSessionID,
    }
    const second: Task = {
      ...makeTask("T-session-b"),
      status: "pending",
      threadID: parentSessionID,
    }
    const firstPath = join(getTaskDir({}, directory), `${first.id}.json`)
    const secondPath = join(getTaskDir({}, directory), `${second.id}.json`)
    writeJsonAtomic(firstPath, first)
    writeJsonAtomic(secondPath, second)
    const client = makeClient([assistantMessage()])

    //#when
    await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_child_run_two",
      config: makeConfig(),
      parentSessionID,
    })

    //#then
    expect(readJsonSafe(firstPath, TaskSchema)?.metadata?.effort).toBeUndefined()
    expect(readJsonSafe(secondPath, TaskSchema)?.metadata?.effort).toBeUndefined()
  })

  test("resolves null instead of throwing when the client rejects", async () => {
    //#given
    const client = {
      session: {
        context: async (_input: { sessionID: string }): Promise<unknown> => {
          throw new Error("context failed")
        },
      },
    }

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_error",
      config: makeConfig(),
    })

    //#then
    expect(result).toBeNull()
  })

  test("produces finite numbers and a computedAt timestamp", async () => {
    //#given
    const client = makeClient([assistantMessage()])

    //#when
    const result = await recordEffortForForeground({
      client,
      directory,
      sessionID: "ses_finite",
      config: makeConfig(),
    })

    //#then
    expect(result).not.toBeNull()
    const record = result!.record
    expect(Number.isNaN(Date.parse(record.computedAt))).toBe(false)
    const numbers = [
      record.total,
      record.tokenUsd,
      record.components.computeUnits,
      record.components.actionUnits,
      record.components.epistemicUnits,
      record.components.coordUnits,
      record.components.tokenUsd,
      record.components.total,
      record.telemetry.input,
      record.telemetry.output,
      record.telemetry.reasoning,
      record.telemetry.cacheRead,
      record.telemetry.cacheWrite,
      record.telemetry.steps,
      record.telemetry.toolCalls,
      record.telemetry.uniqueTools,
      record.telemetry.retries,
      record.telemetry.durationMs,
    ]
    for (const value of numbers) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})
