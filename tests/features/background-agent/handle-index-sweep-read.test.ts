import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  currentGeneration,
  getBgHandleDir,
  getHandlePath,
  readHandles,
  sweepAndReadHandles,
  sweepStaleHandles,
  writeHandle,
} from "../../../src/features/background-agent/handle-index"
import { restoreHandles } from "../../../src/features/background-agent/manager/lifecycle"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { createManagerRuntime } from "./harness/manager-runtime.fixture"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "matrixx-bg-sweepread-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_abc12345",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "Investigate the thing",
    prompt: "secret prompt",
    agent: "explore",
    status: "running",
    queuedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

describe("sweepAndReadHandles", () => {
  test("returns empty result when the directory does not exist", () => {
    //#given a project with no handle directory
    //#when sweeping and reading in one pass
    const result = sweepAndReadHandles(dir)

    //#then nothing is returned and nothing throws
    expect(result.handles).toEqual([])
    expect(result.removed).toBe(0)
  })

  test("keeps fresh handles and reports zero removed", () => {
    //#given a fresh handle
    const now = Date.now()
    writeHandle(
      dir,
      makeTask({ completedAt: new Date(now - 1000), lastActivityAt: new Date(now - 1000) }),
    )

    //#when sweeping and reading in one pass
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then the handle is kept
    expect(result.removed).toBe(0)
    expect(result.handles.map((h) => h.taskId)).toEqual(["bg_abc12345"])
  })

  test("sweeps expired handles and bumps generation", () => {
    //#given one stale and one fresh handle
    const now = Date.now()
    writeHandle(dir, makeTask({ id: "bg_stale111", completedAt: new Date(now - 60 * 60 * 1000) }))
    writeHandle(
      dir,
      makeTask({
        id: "bg_fresh222",
        completedAt: new Date(now - 1000),
        lastActivityAt: new Date(now - 1000),
      }),
    )

    //#when sweeping and reading in one pass
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then only the fresh handle is returned and generation was bumped
    expect(result.removed).toBe(1)
    expect(result.handles.map((h) => h.taskId)).toEqual(["bg_fresh222"])
    expect(existsSync(getHandlePath(dir, "bg_stale111"))).toBe(false)
    expect(currentGeneration(dir, "bg_stale111")).toBeGreaterThanOrEqual(1)
  })

  test("sweeps corrupt files without aborting the batch", () => {
    //#given a healthy handle plus corrupt and schema-invalid files
    const now = Date.now()
    const handleDir = getBgHandleDir(dir)
    mkdirSync(handleDir, { recursive: true })
    writeHandle(
      dir,
      makeTask({ completedAt: new Date(now - 1000), lastActivityAt: new Date(now - 1000) }),
    )
    writeFileSync(join(handleDir, "bg_corrupt.json"), "{not json", "utf-8")
    writeFileSync(join(handleDir, "bg_invalid.json"), JSON.stringify({ taskId: 1 }), "utf-8")

    //#when sweeping and reading in one pass
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then corrupt files are swept and the healthy handle is still returned
    expect(result.removed).toBe(2)
    expect(result.handles.map((h) => h.taskId)).toEqual(["bg_abc12345"])
    expect(existsSync(join(handleDir, "bg_corrupt.json"))).toBe(false)
    expect(existsSync(join(handleDir, "bg_invalid.json"))).toBe(false)
  })

  test("sweeps timestamp-less terminal handles and ignores non-handle files", () => {
    //#given a timestamp-less terminal handle and a stray non-handle file
    const handleDir = getBgHandleDir(dir)
    writeHandle(
      dir,
      makeTask({
        id: "bg_notime333",
        status: "completed",
        queuedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
      }),
    )
    mkdirSync(handleDir, { recursive: true })
    writeFileSync(join(handleDir, "notes.txt"), "ignore me", "utf-8")
    const now = Date.now()

    //#when sweeping and reading in one pass
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then the timestamp-less handle is swept and the stray file is untouched
    expect(result.removed).toBe(1)
    expect(result.handles).toEqual([])
    expect(existsSync(join(handleDir, "notes.txt"))).toBe(true)
  })

  test("matches readHandles+sweepStaleHandles semantics", () => {
    //#given a mix of fresh handles
    const now = Date.now()
    writeHandle(
      dir,
      makeTask({ id: "bg_keep111", completedAt: new Date(now - 1000), lastActivityAt: new Date(now - 1000) }),
    )
    writeHandle(
      dir,
      makeTask({ id: "bg_keep222", completedAt: new Date(now - 2000), lastActivityAt: new Date(now - 2000) }),
    )

    //#when reading via the merged helper
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then the result matches the legacy readHandles output
    const legacy = readHandles(dir).map((h) => h.taskId).sort()
    expect(result.handles.map((h) => h.taskId).sort()).toEqual(legacy)
    expect(readdirSync(getBgHandleDir(dir))).toHaveLength(2)
  })
})

describe("TTL sweep liveness predicate", () => {
  test("keeps a running handle fresh by lastActivityAt even when startedAt exceeds the TTL", () => {
    //#given a running task started an hour ago but active one second ago
    const now = Date.now()
    writeHandle(
      dir,
      makeTask({
        id: "bg_live001",
        status: "running",
        queuedAt: undefined,
        startedAt: new Date(now - 60 * 60 * 1000),
        lastActivityAt: new Date(now - 1000),
      }),
    )

    //#when sweeping with both helpers
    const sweptCount = sweepStaleHandles(dir, 30 * 60 * 1000, now)
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then neither helper deletes the live task
    expect(sweptCount).toBe(0)
    expect(result.removed).toBe(0)
    expect(result.handles.map((h) => h.taskId)).toEqual(["bg_live001"])
    expect(existsSync(getHandlePath(dir, "bg_live001"))).toBe(true)
  })

  test("sweeps a terminal handle whose completedAt exceeds the TTL", () => {
    //#given a completed task finished an hour ago
    const now = Date.now()
    const completed = () =>
      makeTask({
        id: "bg_done001",
        status: "completed",
        queuedAt: undefined,
        startedAt: new Date(now - 2 * 60 * 60 * 1000),
        completedAt: new Date(now - 60 * 60 * 1000),
      })

    //#when sweeping with each helper independently
    writeHandle(dir, completed())
    const sweptCount = sweepStaleHandles(dir, 30 * 60 * 1000, now)

    writeHandle(dir, completed())
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then both helpers remove it and report one removal
    expect(sweptCount).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.handles).toEqual([])
    expect(existsSync(getHandlePath(dir, "bg_done001"))).toBe(false)
  })

  test("never deletes a live handle with unknown liveness but still sweeps corrupt files", () => {
    //#given a running handle with no timestamps at all and a corrupt file
    const handleDir = getBgHandleDir(dir)
    mkdirSync(handleDir, { recursive: true })
    writeHandle(
      dir,
      makeTask({
        id: "bg_unknown001",
        status: "running",
        queuedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
      }),
    )
    writeFileSync(join(handleDir, "bg_corrupt.json"), "{not json", "utf-8")
    const now = Date.now()

    //#when sweeping with each helper independently
    const sweptCount = sweepStaleHandles(dir, 30 * 60 * 1000, now)
    writeFileSync(join(handleDir, "bg_corrupt.json"), "{not json", "utf-8")
    const result = sweepAndReadHandles(dir, 30 * 60 * 1000, now)

    //#then only the corrupt file is swept and the live handle survives both passes
    expect(sweptCount).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.handles.map((h) => h.taskId)).toEqual(["bg_unknown001"])
    expect(existsSync(getHandlePath(dir, "bg_unknown001"))).toBe(true)
    expect(existsSync(join(handleDir, "bg_corrupt.json"))).toBe(false)
  })
})

describe("restoreHandles sweep integration", () => {
  test("keeps a running handle that is fresh by lastActivityAt despite an old startedAt", async () => {
    //#given a running handle started an hour ago but active one second ago
    const now = Date.now()
    writeHandle(
      dir,
      makeTask({
        id: "bg_restore001",
        status: "running",
        queuedAt: undefined,
        startedAt: new Date(now - 60 * 60 * 1000),
        lastActivityAt: new Date(now - 1000),
      }),
    )
    const runtime = createManagerRuntime({ directory: dir })

    try {
      //#when restoring handles after a restart
      await restoreHandles(runtime)

      //#then the live handle is adopted instead of being swept away
      expect(runtime.store.getTask("bg_restore001")).toBeDefined()
      expect(existsSync(getHandlePath(dir, "bg_restore001"))).toBe(true)
    } finally {
      runtime.dispose()
    }
  })
})
