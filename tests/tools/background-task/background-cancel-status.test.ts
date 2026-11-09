/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager, BackgroundTask } from "../../../src/features/background-agent"
import type { MatrixxToolContext } from "../../../src/shared/tool/define-tool"
import type { BackgroundCancelClient } from "../../../src/tools/background-task/clients"
import { createBackgroundCancel } from "../../../src/tools/background-task/create-background-cancel"

const mockContext: MatrixxToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides
  }
}

function createClient(): BackgroundCancelClient {
  return { session: { interrupt: async () => ({}) } }
}

describe("background_cancel status capture", () => {
  test("reports original pending status instead of post-cancel status", async () => {
    //#given a pending task whose cancelTask mutates the shared task to cancelled
    const task = createTask({ id: "task-1", status: "pending" })
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async () => {
        task.status = "cancelled"
        return true
      }
    } as unknown as BackgroundManager
    const tool = createBackgroundCancel(manager, createClient())

    //#when the single pending task is cancelled
    const output = await tool.execute({ taskId: task.id }, mockContext)

    //#then the output reports the original pending status
    expect(output).toContain("Pending task cancelled successfully")
    expect(output).toContain("Status: pending")
    expect(output).not.toContain("Status: cancelled")
  })

  test("reports running status and session id for a running task", async () => {
    //#given a running task whose cancelTask mutates the shared task to cancelled
    const task = createTask({ id: "task-1", status: "running", sessionID: "ses-1" })
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async () => {
        task.status = "cancelled"
        return true
      }
    } as unknown as BackgroundManager
    const tool = createBackgroundCancel(manager, createClient())

    //#when the single running task is cancelled
    const output = await tool.execute({ taskId: task.id }, mockContext)

    //#then the output reports the original running status and session row
    expect(output).toContain("Task cancelled successfully")
    expect(output).toContain("Status: running")
    expect(output).toContain("Session ID: ses-1")
  })

  test("reports failure when cancelTask returns false", async () => {
    //#given a pending task that the manager refuses to cancel
    const task = createTask({ id: "task-1", status: "pending" })
    const manager = {
      getTask: (id: string) => (id === task.id ? task : undefined),
      getAllDescendantTasks: () => [task],
      cancelTask: async () => false
    } as unknown as BackgroundManager
    const tool = createBackgroundCancel(manager, createClient())

    //#when the single task cancel attempt fails
    const output = await tool.execute({ taskId: task.id }, mockContext)

    //#then the error message is unchanged
    expect(output).toBe("[ERROR] Failed to cancel task: task-1")
  })

  test("all-tasks table shows original statuses for running and pending pair", async () => {
    //#given a running and a pending task cancelled together
    const taskA = createTask({ id: "task-a", status: "running", sessionID: "ses-a", description: "running task" })
    const taskB = createTask({ id: "task-b", status: "pending", sessionID: undefined, description: "pending task" })
    const manager = {
      getTask: () => undefined,
      getAllDescendantTasks: () => [taskA, taskB],
      cancelTask: async (taskId: string) => {
        const task = taskId === taskA.id ? taskA : taskB
        task.status = "cancelled"
        return true
      }
    } as unknown as BackgroundManager
    const tool = createBackgroundCancel(manager, createClient())

    //#when all tasks are cancelled
    const output = await tool.execute({ all: true }, mockContext)

    //#then the table preserves each task's original status
    expect(output).toContain("| `task-a` | running task | running | `ses-a` |")
    expect(output).toContain("| `task-b` | pending task | pending | (not started) |")
  })
})
