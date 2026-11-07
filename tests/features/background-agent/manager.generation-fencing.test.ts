/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import {
  deleteHandleFile,
  readHandle,
  writeHandle,
} from "../../../src/features/background-agent/handle-index"
import { StaleGenerationError } from "../../../src/features/task-storage/generation"

function makeManager(dir: string): BackgroundManager {
  const native = {
    session: {
      get: async () => ({ directory: dir }),
      create: async () => ({ id: "sess_new" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory: dir } as never)
}

function seedTask(id: string): BackgroundTask {
  return {
    id,
    parentSessionID: "sess_parent",
    parentMessageID: "msg_1",
    description: "generation task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    sessionID: "sess_child",
    startedAt: new Date(),
  }
}

describe("manager generation fencing", () => {
  let dir: string
  let manager: BackgroundManager

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "mgr-gen-"))
    manager = makeManager(dir)
  })

  afterEach(() => {
    manager.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  test("restore stamps persisted generation onto rehydrated task", async () => {
    //#given
    const task = seedTask("bg_gen01")
    writeHandle(dir, task)

    //#when
    await manager.restoreHandles()
    const restored = manager.getTask("bg_gen01")

    //#then
    const persisted = readHandle(dir, "bg_gen01")
    expect(restored).toBeDefined()
    expect(restored?.generation).toBe(persisted?.generation ?? 0)
  })

  test("fenced persist rejects stale token, state unchanged", () => {
    //#given
    const task = seedTask("bg_gen02")
    writeHandle(dir, task)
    const current = readHandle(dir, "bg_gen02")?.generation ?? 0
    manager.persistHandleFenced(task, current)
    deleteHandleFile(dir, "bg_gen02")
    writeHandle(dir, { ...task, description: "takeover task" })

    //#when
    let error: unknown
    try {
      manager.persistHandleFenced({ ...task, description: "stale overwrite" }, current)
    } catch (err) {
      error = err
    }

    //#then
    expect(error).toBeInstanceOf(StaleGenerationError)
    expect(readHandle(dir, "bg_gen02")?.description).toBe("takeover task")
  })

  test("revive bumps persisted generation so old references stay stale", async () => {
    //#given
    const task: BackgroundTask = {
      ...seedTask("bg_gen03"),
      status: "completed",
    }
    writeHandle(dir, task)
    await manager.restoreHandles()
    const before = readHandle(dir, "bg_gen03")?.generation ?? 0

    //#when
    await manager.revive({
      taskId: "bg_gen03",
      parentSessionID: "sess_parent",
      parentMessageID: "msg_1",
      prompt: "new instruction",
    })

    //#then
    const after = readHandle(dir, "bg_gen03")?.generation ?? 0
    expect(after).toBeGreaterThan(before)
    expect(readHandle(dir, "bg_gen03", before)).toBeNull()
  })
})
