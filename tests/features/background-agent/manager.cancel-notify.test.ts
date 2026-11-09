/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BackgroundManager } from "../../../src/features/background-agent/manager/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { NativePluginContext } from "../../../src/shared/session/session-context-source"
import { createBackgroundCancel } from "../../../src/tools/background-task/create-background-cancel"
import { recordNotifications, type NotificationRecorder } from "./harness/manager-runtime.fixture"

const TOOL_CONTEXT = {
  sessionID: "ses_parent",
  messageID: "msg_1",
  agent: "task",
  abort: new AbortController().signal,
}

function buildCtx(dir: string): NativePluginContext {
  const native = {
    session: {
      create: async () => ({ id: "ses_child" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return { directory: dir, ...native } as unknown as NativePluginContext
}

function seedTask(manager: BackgroundManager, id: string, sessionID: string): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "cancel-notify task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(0),
  }
  manager.tasks.set(task.id, task)
  return task
}

function notificationText(call: unknown): string {
  if (typeof call !== "object" || call === null) return ""
  const text = (call as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

describe("cancel notification (T-22 bug 5)", () => {
  let dir: string
  let manager: BackgroundManager
  let recorder: NotificationRecorder

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mx-cancel-notify-"))
    manager = new BackgroundManager(buildCtx(dir))
    recorder = recordNotifications(manager)
  })

  afterEach(() => {
    recorder.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  test("default cancelTask on a running task emits exactly one parent notification", async () => {
    //#given
    const task = seedTask(manager, "bg_cancel_default", "ses_child_default")

    //#when
    const cancelled = await manager.cancelTask(task.id)

    //#then
    expect(cancelled).toBe(true)
    expect(task.status).toBe("cancelled")
    expect(recorder.calls.length).toBe(1)
    expect(notificationText(recorder.calls[0])).not.toContain("**Error:**")
  })

  test("background_cancel single-task path emits exactly one notification", async () => {
    //#given
    const task = seedTask(manager, "bg_cancel_tool", "ses_child_tool")
    const client = {
      session: { interrupt: async () => undefined },
    } as unknown as Parameters<typeof createBackgroundCancel>[1]
    const tool = createBackgroundCancel(manager, client)

    //#when
    const result = await tool.execute({ taskId: task.id }, TOOL_CONTEXT)

    //#then
    expect(String(result)).toContain("Task cancelled successfully")
    expect(task.status).toBe("cancelled")
    expect(recorder.calls.length).toBe(1)
  })

  test("cancelAllForSession keeps bulk stop silent", async () => {
    //#given
    const task = seedTask(manager, "bg_cancel_all", "ses_child_all")

    //#when
    const count = manager.cancelAllForSession(task.parentSessionID)
    await new Promise((resolve) => setTimeout(resolve, 20))

    //#then
    expect(count).toBe(1)
    expect(task.status).toBe("cancelled")
    expect(recorder.calls.length).toBe(0)
  })

  test("cancelled task keeps terminal defaults and error-free notification body", async () => {
    //#given
    const task = seedTask(manager, "bg_cancel_clean", "ses_child_clean")

    //#when
    await manager.cancelTask(task.id)

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.terminalReason).toBeUndefined()
    expect(task.error).toBeUndefined()
    expect(recorder.calls.length).toBe(1)
    expect(notificationText(recorder.calls[0])).not.toContain("**Error:**")
  })
})
