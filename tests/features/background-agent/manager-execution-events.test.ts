const { describe, test, expect } = require("bun:test")
import { tmpdir } from "node:os"
import type { MatrixxContext } from "../../../src/plugin/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function createBackgroundManager(): BackgroundManager {
  const native = {
    session: {
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory: tmpdir() } as unknown as MatrixxContext)
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; sessionID: string; parentSessionID: string }): BackgroundTask {
  return {
    parentMessageID: "mock-message-id",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

describe("BackgroundManager.handleEvent - session.execution terminal events", () => {
  test("completes running task on session.execution.succeeded", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "ses_exec_ok_1"
    const task = createMockTask({
      id: "task-exec-succeeded",
      sessionID,
      parentSessionID: "parent-session",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({ type: "session.execution.succeeded", data: { sessionID } })

    //#then
    expect(task.status).toBe("completed")
    expect(task.completedAt).toBeInstanceOf(Date)

    manager.shutdown()
  })

  test("errors running task on session.execution.failed", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "ses_exec_fail_1"
    const task = createMockTask({
      id: "task-exec-failed",
      sessionID,
      parentSessionID: "parent-session",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({ type: "session.execution.failed", data: { sessionID } })

    //#then
    expect(task.status).toBe("error")
    expect(task.completedAt).toBeInstanceOf(Date)

    manager.shutdown()
  })
})
