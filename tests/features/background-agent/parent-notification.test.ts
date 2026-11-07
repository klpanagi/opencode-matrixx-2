/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function buildRuntime(dir: string, promptCalls: Array<{ sessionID: string; text: string }>): ManagerRuntime {
  const store = new ManagerStore(dir)
  const native = {
    session: {
      prompt: async (args: { sessionID: string; text: string }) => {
        promptCalls.push({ sessionID: args.sessionID, text: args.text })
        return {}
      },
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return {
    store,
    native: native as unknown as ManagerRuntime["native"],
    directory: dir,
    taskHistory: new TaskHistory(),
  }
}

function seedTask(store: ManagerStore, overrides: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "ses_parent_1",
    parentMessageID: "msg-1",
    description: "parent notified task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    sessionID: "ses_child_1",
    startedAt: new Date(Date.now() - 12000),
    ...overrides,
  }
  store.tasks.set(task.id, task)
  return task
}

describe("deliverParentNotification via handleManagerEvent", () => {
  let dir: string

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "parent-notif-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("session.idle prompts parent with [BACKGROUND TASK text", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const rt = buildRuntime(dir, promptCalls)
    seedTask(rt.store, { id: "bg_idle_1" })
    seedTask(rt.store, { id: "bg_sibling_1", sessionID: "ses_child_2", description: "sibling still running" })

    //#when
    rt.store.findBySession("ses_child_1")
    handleManagerEvent(rt, { type: "session.idle", data: { sessionID: "ses_child_1" } } as unknown as Parameters<typeof handleManagerEvent>[1])
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("ses_parent_1")
    expect(promptCalls[0].text).toContain("[BACKGROUND TASK")
  })

  test("unknown session does NOT prompt parent", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const rt = buildRuntime(dir, promptCalls)
    seedTask(rt.store, { id: "bg_known_1" })

    //#when
    handleManagerEvent(rt, { type: "session.idle", data: { sessionID: "ses_unknown_xyz" } } as unknown as Parameters<typeof handleManagerEvent>[1])
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then
    expect(promptCalls.length).toBe(0)
  })
})
