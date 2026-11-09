/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BgHandleSchema, getBgHandleDir, readHandle, readHandles, toHandle, writeHandle } from "../../../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "matrixx-bg-handle-schema-v2-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_v2task001",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "Investigate the thing",
    prompt: "secret prompt that must not be persisted",
    agent: "explore",
    status: "running",
    queuedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

describe("BgHandleSchema v2 persisted fields", () => {
  test("accepts every v2 key when present", () => {
    //#given a handle payload carrying all six v2 keys
    const payload = {
      taskId: "bg_v2task001",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
      agent: "explore",
      status: "error",
      origin: "delegation",
      lastActivityAt: 1_767_225_600_000,
      deadlineAt: 1_767_226_200_000,
      error: "boom",
      resultSummary: "Partial output before failure",
      progress: { toolCalls: 3, lastUpdate: 1_767_225_590_000 },
    }

    //#when parsing against the extended strict schema
    const result = BgHandleSchema.safeParse(payload)

    //#then all six keys are accepted and preserved
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.origin).toBe("delegation")
      expect(result.data.error).toBe("boom")
      expect(result.data.resultSummary).toBe("Partial output before failure")
      expect(result.data.progress?.toolCalls).toBe(3)
    }
  })

  test("parses a dev-head-shaped legacy handle with none of the v2 keys", () => {
    //#given a handle JSON exactly as the dev-head build persists it
    const legacy = {
      taskId: "bg_legacy001",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
      description: "Investigate the thing",
      title: "[BG] Mouse[explore] — Investigate the thing",
      agent: "explore",
      status: "running",
      sessionID: "ses_child",
      concurrencyGroup: "explore:provider/model",
      queuedAt: 1_767_225_600_000,
      startedAt: 1_767_225_605_000,
      generation: 3,
    }

    //#when parsing against the extended strict schema
    const result = BgHandleSchema.safeParse(legacy)

    //#then it still parses and the v2 fields stay absent
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.origin).toBeUndefined()
      expect(result.data.lastActivityAt).toBeUndefined()
      expect(result.data.deadlineAt).toBeUndefined()
      expect(result.data.error).toBeUndefined()
      expect(result.data.resultSummary).toBeUndefined()
      expect(result.data.progress).toBeUndefined()
    }
  })
})

describe("toHandle projection of v2 fields", () => {
  test("projects error from the task", () => {
    //#given a task terminated with an error
    const task = makeTask({ status: "error", error: "boom" })

    //#when projecting to a handle
    const handle = toHandle(task)

    //#then the error message is carried onto the handle (parent-commit failure was undefined)
    expect(handle.error).toBe("boom")
  })

  test("projects resultSummary from the task", () => {
    //#given a task with a persisted result summary
    const task = makeTask({ resultSummary: "Subagent finished the investigation" })

    //#when projecting to a handle
    const handle = toHandle(task)

    //#then the summary is carried onto the handle
    expect(handle.resultSummary).toBe("Subagent finished the investigation")
  })

  test("projects Date fields to epoch milliseconds", () => {
    //#given a task with liveness/deadline dates
    const task = makeTask({
      lastActivityAt: new Date("2026-01-01T00:10:00.000Z"),
      deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
    })

    //#when projecting to a handle
    const handle = toHandle(task)

    //#then both dates become epoch ms
    expect(handle.lastActivityAt).toBe(Date.parse("2026-01-01T00:10:00.000Z"))
    expect(handle.deadlineAt).toBe(Date.parse("2026-01-01T01:00:00.000Z"))
  })

  test("projects only the serializable subset of progress", () => {
    //#given a task whose progress carries ephemeral fields too
    const task = makeTask({
      progress: {
        toolCalls: 4,
        lastTool: "bash",
        lastUpdate: new Date("2026-01-01T00:02:00.000Z"),
        lastMessage: "still working",
        lastMessageAt: new Date("2026-01-01T00:02:30.000Z"),
        toolCallWindow: { lastSignature: "sig", consecutiveCount: 2, threshold: 3 },
        countedToolPartIDs: new Set(["part_1"]),
      },
    })

    //#when projecting to a handle
    const handle = toHandle(task)

    //#then the persisted progress is JSON-serializable and drops ephemeral fields
    expect(handle.progress).toEqual({
      toolCalls: 4,
      lastTool: "bash",
      lastUpdate: Date.parse("2026-01-01T00:02:00.000Z"),
      lastMessage: "still working",
    })
    expect(handle.progress).not.toHaveProperty("toolCallWindow")
    expect(handle.progress).not.toHaveProperty("countedToolPartIDs")
    expect(handle.progress).not.toHaveProperty("lastMessageAt")
  })

  test("projects origin onto the handle", () => {
    //#given a task adopted from a native subagent
    const task = makeTask({ origin: "native" })

    //#when projecting to a handle
    const handle = toHandle(task)

    //#then the origin marker is persisted
    expect(handle.origin).toBe("native")
  })
})

describe("handle v2 round-trip", () => {
  test("all six v2 fields survive writeHandle -> readHandle", () => {
    //#given a task populated with every v2 field
    const task = makeTask({
      status: "error",
      sessionID: "ses_child",
      origin: "delegation",
      lastActivityAt: new Date("2026-01-01T00:10:00.000Z"),
      deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
      error: "boom",
      resultSummary: "Partial output before failure",
      progress: {
        toolCalls: 7,
        lastTool: "read",
        lastUpdate: new Date("2026-01-01T00:09:00.000Z"),
        lastMessage: "reading files",
      },
    })

    //#when persisting and reading the handle back by id
    writeHandle(dir, task)
    const handle = readHandle(dir, task.id)

    //#then every v2 field round-trips intact
    expect(handle).not.toBeNull()
    expect(handle?.origin).toBe("delegation")
    expect(handle?.lastActivityAt).toBe(Date.parse("2026-01-01T00:10:00.000Z"))
    expect(handle?.deadlineAt).toBe(Date.parse("2026-01-01T01:00:00.000Z"))
    expect(handle?.error).toBe("boom")
    expect(handle?.resultSummary).toBe("Partial output before failure")
    expect(handle?.progress).toEqual({
      toolCalls: 7,
      lastTool: "read",
      lastUpdate: Date.parse("2026-01-01T00:09:00.000Z"),
      lastMessage: "reading files",
    })
  })

  test("all six v2 fields survive readHandles", () => {
    //#given a persisted task with the v2 fields set
    const task = makeTask({
      origin: "native",
      lastActivityAt: new Date("2026-01-01T00:10:00.000Z"),
      deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
      resultSummary: "Done",
    })

    //#when reading the whole directory
    writeHandle(dir, task)
    const [handle] = readHandles(dir)

    //#then the fields are present on the directory read
    expect(handle.origin).toBe("native")
    expect(handle.lastActivityAt).toBe(Date.parse("2026-01-01T00:10:00.000Z"))
    expect(handle.deadlineAt).toBe(Date.parse("2026-01-01T01:00:00.000Z"))
    expect(handle.resultSummary).toBe("Done")
  })

  test("legacy on-disk handle without v2 keys still loads", () => {
    //#given a dev-head-shaped handle file written directly to disk
    const handleDir = getBgHandleDir(dir)
    mkdirSync(handleDir, { recursive: true })
    writeFileSync(
      join(handleDir, "bg_legacy003.json"),
      JSON.stringify({
        taskId: "bg_legacy003",
        parentSessionID: "ses_parent",
        parentMessageID: "msg_parent",
        description: "Investigate the thing",
        agent: "explore",
        status: "cancelled",
        generation: 0,
      }),
      "utf-8",
    )

    //#when reading all handles from the directory
    const handles = readHandles(dir)

    //#then the legacy handle is still accepted
    expect(handles).toHaveLength(1)
    expect(handles[0].taskId).toBe("bg_legacy003")
    expect(handles[0].origin).toBeUndefined()
  })
})
