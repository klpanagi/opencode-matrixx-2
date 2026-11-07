/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readHandle,
  readHandles,
  sweepStaleHandles,
  deleteHandleFile,
  writeHandle,
} from "../../../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "matrixx-bg-gen-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeTask(id: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: "gen task",
    prompt: "prompt",
    agent: "explore",
    status: "running",
    queuedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

describe("B8 stale handle reuse — generation counter", () => {
  test("stale handle after remove never resolves to recreated task with same id", () => {
    //#given a persisted handle whose generation was captured
    const task = makeTask("bg_reuse111")
    writeHandle(dir, task)
    const [original] = readHandles(dir)
    const staleGen = original.generation ?? 0

    //#when the task is removed and a new task reuses the same id
    deleteHandleFile(dir, task.id)
    writeHandle(dir, makeTask("bg_reuse111", { description: "new task same slot" }))

    //#then the old handle (stale generation) is rejected
    expect(readHandle(dir, task.id, staleGen)).toBeNull()
  })

  test("recreated handle carries a bumped generation", () => {
    //#given a handle that was removed
    const task = makeTask("bg_bump222")
    writeHandle(dir, task)
    const [original] = readHandles(dir)

    //#when removed and recreated
    deleteHandleFile(dir, task.id)
    writeHandle(dir, makeTask("bg_bump222"))

    //#then the new generation is strictly greater and resolves with the fresh gen
    const [recreated] = readHandles(dir)
    expect(recreated.generation).toBeGreaterThan(original.generation ?? 0)
    expect(readHandle(dir, task.id, recreated.generation)).not.toBeNull()
  })

  test("sweep bumps generation so swept handles stay stale", () => {
    //#given a stale persisted handle
    const now = Date.now()
    const task = makeTask("bg_sweep333", { completedAt: new Date(now - 60 * 60 * 1000) })
    writeHandle(dir, task)
    const [original] = readHandles(dir)
    const staleGen = original.generation ?? 0

    //#when swept and recreated under the same id
    sweepStaleHandles(dir, 30 * 60 * 1000, now)
    writeHandle(dir, makeTask("bg_sweep333"))

    //#then the pre-sweep generation no longer resolves
    expect(readHandle(dir, task.id, staleGen)).toBeNull()
  })

  test("handles persisted without generation default to 0 (backward compat)", () => {
    //#given a handle written before generations existed
    const task = makeTask("bg_compat444")
    writeHandle(dir, task)

    //#when reading with default/undefined generation
    const [handle] = readHandles(dir)

    //#then generation defaults to 0 and resolves
    expect(handle.generation).toBe(0)
    expect(readHandle(dir, task.id)).not.toBeNull()
    expect(readHandle(dir, task.id, 0)).not.toBeNull()
  })

  test("unknown generation and missing handle resolve to null", () => {
    //#given a persisted handle
    writeHandle(dir, makeTask("bg_miss555"))

    //#when reading with a wrong generation or a missing id
    //#then both are rejected without throwing
    expect(readHandle(dir, "bg_miss555", 999)).toBeNull()
    expect(readHandle(dir, "bg_nonexistent", 0)).toBeNull()
  })
})
