const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
const { mock, spyOn } = require("bun:test")

import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { _resetTaskToastManagerForTesting, initTaskToastManager } from "../../../src/features/task-toast-manager/manager"
import type { ConcurrencyManager } from "../../../src/features/background-agent/concurrency"
import { MIN_IDLE_TIME_MS } from "../../../src/features/background-agent/constants"
import { writeHandle } from "../../../src/features/background-agent/handle-index"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { _resetMessageDirCacheForTesting, findNearestMessageExcludingCompaction, getMessageDir } from "../../../src/features/background-agent/message-dir"
import type { BackgroundTask, ResumeInput } from "../../../src/features/background-agent/types"
import { registerSubagentSession, subagentSessions } from "../../../src/features/session-state"

// Shared fs call counters for mock.module("node:fs")-based tests
// (getMessageDir caching + B2 readFileSync regression).
// Declared here so both describe blocks can reference the same counters.
const mockCalls: { existsSync: number; readdirSync: number } = { existsSync: 0, readdirSync: 0 }

const TASK_TTL_MS = 30 * 60 * 1000

class MockBackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map()
  private notifications: Map<string, BackgroundTask[]> = new Map()
  public resumeCalls: Array<{ sessionId: string; prompt: string }> = []

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      if (child.sessionID) {
        const descendants = this.getAllDescendantTasks(child.sessionID)
        result.push(...descendants)
      }
    }

    return result
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? []
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionID)
      } else {
        this.notifications.set(sessionID, filtered)
      }
    }
  }

  pruneStaleTasksAndNotifications(): { prunedTasks: string[]; prunedNotifications: number } {
    const now = Date.now()
    const prunedTasks: string[] = []
    let prunedNotifications = 0

    for (const [taskId, task] of this.tasks.entries()) {
      if (!task.startedAt) continue
      const age = now - task.startedAt.getTime()
      if (age > TASK_TTL_MS) {
        prunedTasks.push(taskId)
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
      }
    }

    for (const [sessionID, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionID)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        if (!task.startedAt) return false
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      const removed = notifications.length - validNotifications.length
      prunedNotifications += removed
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionID)
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionID, validNotifications)
      }
    }

    return { prunedTasks, prunedNotifications }
  }

  getTaskCount(): number {
    return this.tasks.size
  }

  getNotificationCount(): number {
    let count = 0
    for (const notifications of this.notifications.values()) {
      count += notifications.length
    }
    return count
  }

  resume(input: ResumeInput): BackgroundTask {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    if (existingTask.status === "running") {
      return existingTask
    }

    this.resumeCalls.push({ sessionId: input.sessionId, prompt: input.prompt })

    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    return existingTask
  }
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

function createBackgroundManager(): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

function getConcurrencyManager(manager: BackgroundManager): ConcurrencyManager {
  return (manager as unknown as { concurrencyManager: ConcurrencyManager }).concurrencyManager
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return (manager as unknown as { pendingByParent: Map<string, Set<string>> }).pendingByParent
}

function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return (manager as unknown as { completionTimers: Map<string, ReturnType<typeof setTimeout>> }).completionTimers
}

function getQueuesByKey(
  manager: BackgroundManager
): Map<string, Array<{ task: BackgroundTask; input: import("../../../src/features/background-agent/types").LaunchInput }>> {
  return (manager as unknown as {
    queuesByKey: Map<string, Array<{ task: BackgroundTask; input: import("../../../src/features/background-agent/types").LaunchInput }>>
  }).queuesByKey
}

async function processKeyForTest(manager: BackgroundManager, key: string): Promise<void> {
  return (manager as unknown as { processKey: (key: string) => Promise<void> }).processKey(key)
}

function pruneStaleTasksAndNotificationsForTest(manager: BackgroundManager): void {
  ;(manager as unknown as { pruneStaleTasksAndNotifications: () => void }).pruneStaleTasksAndNotifications()
}

async function tryCompleteTaskForTest(manager: BackgroundManager, task: BackgroundTask): Promise<boolean> {
  return (manager as unknown as { tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean> })
    .tryCompleteTask(task, "test")
}

function stubNotifyParentSession(manager: BackgroundManager): void {
  ;(manager as unknown as { notifyParentSession: () => Promise<void> }).notifyParentSession = async () => {}
}

function getNestedActive(manager: BackgroundManager): Map<string, number> {
  return (manager as unknown as { nestedActive: Map<string, number> }).nestedActive
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitForCondition timed out")
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function createToastRemoveTaskTracker(): { removeTaskCalls: string[]; resetToastManager: () => void } {
  _resetTaskToastManagerForTesting()
  const toastManager = initTaskToastManager({
    tui: { showToast: async () => {} },
  } as unknown as PluginInput["client"])
  const removeTaskCalls: string[] = []
  const originalRemoveTask = toastManager.removeTask.bind(toastManager)
  toastManager.removeTask = (taskId: string): void => {
    removeTaskCalls.push(taskId)
    originalRemoveTask(taskId)
  }
  return {
    removeTaskCalls,
    resetToastManager: _resetTaskToastManagerForTesting,
  }
}

function getCleanupSignals(): Array<NodeJS.Signals | "beforeExit" | "exit"> {
  const signals: Array<NodeJS.Signals | "beforeExit" | "exit"> = ["SIGINT", "SIGTERM", "beforeExit", "exit"]
  if (process.platform === "win32") {
    signals.push("SIGBREAK")
  }
  return signals
}

function getListenerCounts(signals: Array<NodeJS.Signals | "beforeExit" | "exit">): Record<string, number> {
  return Object.fromEntries(signals.map((signal) => [signal, process.listenerCount(signal)]))
}


describe("BackgroundManager.resume", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // given
    manager = new MockBackgroundManager()
  })

  test("should throw error when task not found", () => {
    // given - empty manager

    // when / #then
    expect(() => manager.resume({
      sessionId: "non-existent",
      prompt: "continue",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })).toThrow("Task not found for session: non-existent")
  })

  test("should resume existing task and reset state to running", () => {
    // given
    const completedTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    completedTask.completedAt = new Date()
    completedTask.error = "previous error"
    manager.addTask(completedTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue the work",
      parentSessionID: "session-new-parent",
      parentMessageID: "msg-new",
    })

    // then
    expect(result.status).toBe("running")
    expect(result.completedAt).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.parentSessionID).toBe("session-new-parent")
    expect(result.parentMessageID).toBe("msg-new")
  })

  test("should preserve task identity while updating parent context", () => {
    // given
    const existingTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "old-parent",
      description: "original description",
      agent: "trinity",
      status: "completed",
    })
    manager.addTask(existingTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "new prompt",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    })

    // then
    expect(result.id).toBe("task-a")
    expect(result.sessionID).toBe("session-a")
    expect(result.description).toBe("original description")
    expect(result.agent).toBe("trinity")
    expect(result.parentModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" })
  })

  test("should track resume calls with prompt", () => {
    // given
    const task = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    manager.addTask(task)

    // when
    manager.resume({
      sessionId: "session-a",
      prompt: "continue with additional context",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // then
    expect(manager.resumeCalls).toHaveLength(1)
    expect(manager.resumeCalls[0]).toEqual({
      sessionId: "session-a",
      prompt: "continue with additional context",
    })
  })

  test("should preserve existing tool call count in progress", () => {
    // given
    const taskWithProgress = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    taskWithProgress.progress = {
      toolCalls: 42,
      lastTool: "read",
      lastUpdate: new Date(),
    }
    manager.addTask(taskWithProgress)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // then
    expect(result.progress?.toolCalls).toBe(42)
  })

  test("should ignore resume when task is already running", () => {
    // given
    const runningTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "running",
    })
    manager.addTask(runningTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "resume should be ignored",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
    })

    // then
    expect(result.parentSessionID).toBe("session-parent")
    expect(manager.resumeCalls).toHaveLength(0)
  })
})

describe("LaunchInput.skillContent", () => {
  test("skillContent should be optional in LaunchInput type", () => {
    // given
    const input: import("../../../src/features/background-agent/types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "trinity",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
    }

    // when / #then - should compile without skillContent
    expect(input.skillContent).toBeUndefined()
  })

  test("skillContent can be provided in LaunchInput", () => {
    // given
    const input: import("../../../src/features/background-agent/types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "trinity",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
      skillContent: "You are a playwright expert",
    }

    // when / #then
    expect(input.skillContent).toBe("You are a playwright expert")
  })
})

interface CurrentMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string }
}


describe("BackgroundManager.trackTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("duplicate registration returns the existing task without duplicating", async () => {
    // NOTE (D5): the concurrency semaphore is gone — trackTask dedupes by
    // taskId and returns the existing record (native session owns liveness).
    // given
    const input = {
      taskId: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      description: "external task",
      agent: "task",
      concurrencyKey: "external-key",
    }

    // when
    const first = await manager.trackTask(input)
    const again = await manager.trackTask(input)

    // then
    expect(getTaskMap(manager).size).toBe(1)
    expect(again.id).toBe(first.id)
    expect(getTaskMap(manager).get("task-1")).toBe(first)
  })
})


describe("BackgroundManager.resume model persistence", () => {
   let manager: BackgroundManager
   let promptCalls: Array<{ path: { id: string }; body: Record<string, unknown> }>

   beforeEach(() => {
     // given
     promptCalls = []
     const promptMock = async (args: { path: { id: string }; body: Record<string, unknown> }) => {
       promptCalls.push(args)
       return {}
     }
     const client = {
       session: {
         prompt: promptMock,
         promptAsync: promptMock,
         abort: async () => ({}),
       },
     }
     manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
     stubNotifyParentSession(manager)
   })

  afterEach(() => {
    manager.shutdown()
  })

  test("should pass model when task has a configured model", async () => {
    // given - task with model from category config
    const taskWithModel: BackgroundTask = {
      id: "task-with-model",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task with model override",
      prompt: "original prompt",
      agent: "trinity",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      concurrencyGroup: "trinity",
    }
    getTaskMap(manager).set(taskWithModel.id, taskWithModel)

    // when
    await manager.resume({
      sessionId: "session-1",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // then - model should be passed in prompt body
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" })
    expect(promptCalls[0].body.agent).toBe("trinity")
  })

  test("should NOT pass model when task has no model (backward compatibility)", async () => {
    // given - task without model (default behavior)
    const taskWithoutModel: BackgroundTask = {
      id: "task-no-model",
      sessionID: "session-2",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task without model",
      prompt: "original prompt",
      agent: "trinity",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "trinity",
    }
    getTaskMap(manager).set(taskWithoutModel.id, taskWithoutModel)

    // when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // then - model should NOT be in prompt body
    expect(promptCalls).toHaveLength(1)
    expect("model" in promptCalls[0].body).toBe(false)
    expect(promptCalls[0].body.agent).toBe("trinity")
  })
})


describe("BackgroundManager.handleEvent - session.error", () => {
  test("sets task to error, persists the handle, and keeps it listed", async () => {
    // NOTE (D5): no concurrency semaphore or parent queue remains — the
    // native session.error event marks the task and persists its handle.
    //#given
    const manager = createBackgroundManager()

    const sessionID = "ses_error_1"
    const task = createMockTask({
      id: "task-session-error",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task that errors",
      agent: "trinity",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: {
          name: "UnknownError",
          data: { message: "Model not found: kimi-for-coding/k2p5." },
        },
      },
    })

    //#then
    expect(task.status).toBe("error")
    expect(task.error).toBe("Model not found: kimi-for-coding/k2p5.")
    expect(task.completedAt).toBeInstanceOf(Date)
    expect(getTaskMap(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("removes errored task from toast manager", () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const sessionID = "ses_error_toast"
    const task = createMockTask({
      id: "task-session-error-toast",
      sessionID,
      parentSessionID: "parent-session",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: { name: "UnknownError", message: "boom" },
      },
    })

    //#then
    expect(removeTaskCalls).toContain(task.id)

    manager.shutdown()
    resetToastManager()
  })

  test("ignores session.error for non-running tasks", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "ses_error_ignored"
    const task = createMockTask({
      id: "task-non-running",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task already done",
      agent: "trinity",
      status: "completed",
    })
    task.completedAt = new Date()
    task.error = "previous"
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: { name: "UnknownError", message: "should not matter" },
      },
    })

    //#then
    expect(task.status).toBe("completed")
    expect(task.error).toBe("previous")
    expect(getTaskMap(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("ignores session.error for unknown session", () => {
    //#given
    const manager = createBackgroundManager()

    //#when
    const handler = () =>
      manager.handleEvent({
        type: "session.error",
        properties: {
          sessionID: "ses_unknown",
          error: { name: "UnknownError", message: "Model not found" },
        },
      })

    //#then
    expect(handler).not.toThrow()

    manager.shutdown()
  })
})


describe("getMessageDir cached after first call", () => {
  const testStorage = join(tmpdir(), `msgdir-b4-cache-${randomUUID()}`)
  const testMessageStorage = join(testStorage, "message")
  const sessionID = `ses_b4_${randomUUID()}`
  const sessionDir = join(testMessageStorage, sessionID)

  beforeEach(() => {
    mkdirSync(testMessageStorage, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    try {
      rmSync(testStorage, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  test("getMessageDir cached after first call", async () => {
    //#given
    // Mock storage paths to point to our tmpdir (same pattern as B2)
    mock.module("../../../src/shared/opencode-storage-paths", () => ({
      OPENCODE_STORAGE: testStorage,
      MESSAGE_STORAGE: testMessageStorage,
      PART_STORAGE: join(testStorage, "part"),
      SESSION_STORAGE: join(testStorage, "session"),
    }))

    // Dynamic import with cache buster gets mocked storage paths
    const { getMessageDir: isolatedGetMessageDir } = await import(
      `../../../src/features/background-agent/message-dir?bust=${randomUUID()}`
    )

    // Session dir does NOT exist yet
    expect(fs.existsSync(sessionDir)).toBe(false)

    //#when — first call: session not found, caches null
    const result1 = isolatedGetMessageDir(sessionID)

    //#then
    expect(result1).toBeNull()

    // Now create the session dir (simulates session appearing after first call)
    mkdirSync(sessionDir, { recursive: true })

    //#when — second call: should return cached null, NOT the new dir
    const result2 = isolatedGetMessageDir(sessionID)

    //#then — if cache works, result2 is still null (cached from first call)
    //        if cache is broken, result2 would be sessionDir
    expect(result2).toBeNull()
  })
})

// ----- B2 regression: findNearestMessageExcludingCompaction must read each file once -----
//
// The previous two-pass implementation called readFileSync on the same .json file
// twice (once in the "full" pass, once in the "partial" pass). This test asserts
// the single-pass contract: exactly one readFileSync call per unique file.
//
// Uses mock.module for 'node:fs' and '../../shared/opencode-storage-paths' so
// this file MUST be added to the mock-heavy lists in .github/workflows/ci.yml
// AND .github/workflows/publish.yml.

const B2_TEST_STORAGE = join(tmpdir(), `b2-mgr-test-${randomUUID()}`)
const B2_TEST_MESSAGE_STORAGE = join(B2_TEST_STORAGE, "message")
const B2_SESSION_ID = `ses_b2_${randomUUID()}`
const B2_SESSION_DIR = join(B2_TEST_MESSAGE_STORAGE, B2_SESSION_ID)
const B2_N_FILES = 3

describe("findNearestMessageExcludingCompaction reads each file once", () => {
  beforeEach(() => {
    mkdirSync(B2_SESSION_DIR, { recursive: true })
    for (let i = 0; i < B2_N_FILES; i++) {
      // Oldest file carries a partial (agent-only) attribution: no file
      // matches the full pass, so all files are read exactly once and the
      // partial pass resolves the oldest. Newer files are unattributed.
      const body =
        i === 0
          ? { agent: "b2-agent", info: { role: "assistant" } }
          : { info: { role: "user" } }
      writeFileSync(
        join(B2_SESSION_DIR, `msg_${String(i).padStart(3, "0")}.json`),
        JSON.stringify(body),
      )
    }
  })

  afterEach(() => {
    mock.restore()
    try {
      rmSync(B2_TEST_STORAGE, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  test("findNearestMessageExcludingCompaction reads each file once", async () => {
    //#given
    // Capture real fs functions BEFORE mock so wrappers don't recurse.
    const realFsNs = require("node:fs") as typeof import("node:fs")
    const realExistsSync = realFsNs.existsSync
    const realReadFileSync = realFsNs.readFileSync
    const realReaddirSync = realFsNs.readdirSync

    mock.module("../../../src/shared/opencode-storage-paths", () => ({
      OPENCODE_STORAGE: B2_TEST_STORAGE,
      MESSAGE_STORAGE: B2_TEST_MESSAGE_STORAGE,
      PART_STORAGE: join(B2_TEST_STORAGE, "part"),
      SESSION_STORAGE: join(B2_TEST_STORAGE, "session"),
    }))

    let readFileSyncCalls = 0
    const readFileSyncCallsByPath = new Map<string, number>()
    mock.module("node:fs", () => {
      const wrapped = {
        ...realFsNs,
        existsSync: (path: string) => realExistsSync(path),
        readFileSync: (...args: unknown[]) => {
          readFileSyncCalls++
          const first = args[0]
          if (typeof first === "string") {
            readFileSyncCallsByPath.set(first, (readFileSyncCallsByPath.get(first) ?? 0) + 1)
          }
          return realReadFileSync(...(args as Parameters<typeof realReadFileSync>))
        },
        readdirSync: (path: string) => realReaddirSync(path),
      }
      return wrapped as unknown as typeof realFsNs
    })

    // NOTE (D5): notifyParentSession was deleted with the parent
    // notification pipeline. Exercise the single-pass reader directly —
    // it is the unit under test (B2: one readFileSync per file).
    //#when
    const nearest = findNearestMessageExcludingCompaction(B2_SESSION_DIR)

    //#then
    expect(nearest).not.toBeNull()
    //#then
    // Single-pass contract: readFileSync must be called exactly once per file.
    // Pre-fix bug: 2 calls per file (3 files × 2 = 6 total).
    // Post-fix: 1 call per file (3 files × 1 = 3 total).
    expect(readFileSyncCalls).toBe(B2_N_FILES)
    expect(readFileSyncCallsByPath.size).toBe(B2_N_FILES)
    for (const [path, count] of readFileSyncCallsByPath) {
      expect(count).toBe(1)
      // sanity: every read path lives inside B2_SESSION_DIR
      expect(path.startsWith(B2_SESSION_DIR)).toBe(true)
    }
  })
})


describe("waitForAllDescendants", () => {
  const PARENT_SESSION = "wait-all-parent-session"
  const SESSION_A = "wait-all-session-a"
  const SESSION_B = "wait-all-session-b"

  function addTaskToManager(
    manager: BackgroundManager,
    overrides: Partial<BackgroundTask> & { id: string; parentSessionID: string; sessionID?: string },
  ): void {
    const taskMap = getTaskMap(manager)
    const task: BackgroundTask = {
      id: overrides.id,
      parentSessionID: overrides.parentSessionID,
      sessionID: overrides.sessionID,
      parentMessageID: "mock-msg",
      description: overrides.description ?? "test task",
      prompt: "test prompt",
      agent: overrides.agent ?? "test-agent",
      status: overrides.status ?? "running",
      startedAt: new Date(),
    }
    taskMap.set(task.id, task)
  }

  test("returns empty when no descendant tasks exist", async () => {
    // #given
    const manager = createBackgroundManager()
    const timeout = 500

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toEqual([])
    expect(result.timedOut).toEqual([])

    manager.shutdown()
  })

  test("returns empty when all descendants are terminal (completed)", async () => {
    // #given
    const manager = createBackgroundManager()
    addTaskToManager(manager, {
      id: "task-completed",
      parentSessionID: PARENT_SESSION,
      sessionID: SESSION_A,
      status: "completed",
      description: "completed task",
    })
    const timeout = 500

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].id).toBe("task-completed")
    expect(result.completed[0].status).toBe("completed")
    expect(result.timedOut).toEqual([])

    manager.shutdown()
  })

  test("returns empty when all descendants are terminal (error)", async () => {
    // #given
    const manager = createBackgroundManager()
    addTaskToManager(manager, {
      id: "task-error",
      parentSessionID: PARENT_SESSION,
      sessionID: SESSION_A,
      status: "error",
      description: "errored task",
    })
    const timeout = 500

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].id).toBe("task-error")
    expect(result.completed[0].status).toBe("error")
    expect(result.timedOut).toEqual([])

    manager.shutdown()
  })

  test("returns timedOut when some tasks are still running after timeout", async () => {
    // #given
    const manager = createBackgroundManager()
    addTaskToManager(manager, {
      id: "task-completed",
      parentSessionID: PARENT_SESSION,
      sessionID: SESSION_A,
      status: "completed",
      description: "completed task",
    })
    addTaskToManager(manager, {
      id: "task-running",
      parentSessionID: PARENT_SESSION,
      sessionID: SESSION_B,
      status: "running",
      description: "still running",
    })
    const timeout = 100

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].id).toBe("task-completed")
    expect(result.timedOut).toHaveLength(1)
    expect(result.timedOut[0].id).toBe("task-running")
    expect(result.timedOut[0].status).toBe("running")

    manager.shutdown()
  })

  test("includes pending tasks in timedOut", async () => {
    // #given
    const manager = createBackgroundManager()
    addTaskToManager(manager, {
      id: "task-pending",
      parentSessionID: PARENT_SESSION,
      sessionID: undefined,
      status: "pending",
      description: "never started",
    })
    const timeout = 100

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toEqual([])
    expect(result.timedOut).toHaveLength(1)
    expect(result.timedOut[0].id).toBe("task-pending")
    expect(result.timedOut[0].status).toBe("pending")

    manager.shutdown()
  })

  test("recurses into descendant sessions", async () => {
    // #given
    const manager = createBackgroundManager()
    // Parent session launches a child that itself has a child
    addTaskToManager(manager, {
      id: "child-task",
      parentSessionID: PARENT_SESSION,
      sessionID: SESSION_A,
      status: "completed",
      description: "child",
    })
    addTaskToManager(manager, {
      id: "grandchild-task",
      parentSessionID: SESSION_A,
      sessionID: SESSION_B,
      status: "completed",
      description: "grandchild",
    })
    const timeout = 500

    // #when
    const result = await manager.waitForAllDescendants(PARENT_SESSION, timeout)

    // #then
    expect(result.completed).toHaveLength(2)
    expect(result.completed.map((t) => t.id).sort()).toEqual(["child-task", "grandchild-task"])
    expect(result.timedOut).toEqual([])

    manager.shutdown()
  })
})
