import type { BackgroundTaskConfig } from "../../../config/schema"
import { log } from "../../../shared"
import { getParentSessionID, getSubagentSessionIDs } from "../../session-state/state"
import { StaleGenerationError } from "../../task-storage/generation"
import { KNOWN_SESSIONS_MAX, TASK_TTL_MS } from "../constants"
import type { BgHandle } from "../handle-index"
import { bumpGeneration, currentGeneration, readHandle, readHandles, writeHandle } from "../handle-index"
import { TaskMap } from "../task-map"
import type { BackgroundTask, BackgroundTerminalReason } from "../types"
import { WallclockSupervisor } from "../wallclock"
import type { ManagerTimerHandle, ManagerTimers, NativeDescendant } from "./types"

/**
 * Narrow a persisted handle reason onto the current terminal-reason union.
 * `stale`/`expired` survive only in old handles, so restored tasks drop them.
 */
export function toRestoredReason(
  reason: BgHandle["terminalReason"],
): BackgroundTerminalReason | undefined {
  if (reason === "stale" || reason === "expired") return undefined
  return reason
}

/** Short-TTL cache for native descendant listings (T3). In-memory only. */
const NATIVE_CACHE_TTL_MS = 1000

const DEFAULT_SETTLED_TIMERS: ManagerTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

/**
 * A `waitForAllDescendants` registration.
 *
 * `wake` resolves the current tick early (sibling cancel); `reject` aborts
 * the wait outright (shutdown).
 */
export interface Waiter {
  sessionID: string
  wake: () => void
  reject: (err: unknown) => void
}

/**
 * In-memory task registry behind `BackgroundManager`.
 *
 * Owns the task map, the known-session set, and the native-descendant
 * cache plus every pure state query over them (getters, finders, handle
 * persistence). Lifecycle (launch/track/resume) and reconcile
 * (revive/events/resolve) live in their own modules and operate on this
 * store through `ManagerRuntime` — they never touch `BackgroundManager`.
 */
export class ManagerStore {
  readonly tasks = new TaskMap<BackgroundTask>((sessionID) => ManagerStore.normalizeSessionID(sessionID))
  // Per-instance: each manager owns one store for one project directory, so
  // these caches are already directory-scoped and need no extra key.
  readonly knownSessions = new Set<string>()
  readonly nativeDescCache = new Map<string, { at: number; rows: NativeDescendant[] }>()
  readonly wallclock = new WallclockSupervisor()
  readonly pendingSpawns = new Set<string>()
  readonly waiters = new Set<Waiter>()
  /**
   * Waiter callbacks keyed by task id, notified once the task reaches a
   * terminal status via `notifyTaskSettled`. Each waiter removes itself on
   * settle, timeout, or abort.
   */
  readonly taskSettledWaiters = new Map<string, Set<() => void>>()
  directory: string
  config?: BackgroundTaskConfig

  constructor(directory: string, config?: BackgroundTaskConfig) {
    this.directory = directory
    this.config = config
  }

  static normalizeSessionID(raw: string): string {
    const trimmed = raw.trim()
    const queryIndex = trimmed.indexOf("?")
    const withoutQuery =
      queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed
    const hashIndex = withoutQuery.indexOf("#")
    return hashIndex >= 0 ? withoutQuery.slice(0, hashIndex) : withoutQuery
  }


  /**
   * Insert a known session, evicting the oldest entries (Set insertion
   * order) while the set exceeds KNOWN_SESSIONS_MAX. Re-inserting an id
   * refreshes its position via delete+add.
   */
  rememberKnownSession(sessionID: string): void {
    this.knownSessions.delete(sessionID)
    this.knownSessions.add(sessionID)
    while (this.knownSessions.size > KNOWN_SESSIONS_MAX) {
      const oldest = this.knownSessions.values().next().value
      if (oldest === undefined) break
      this.knownSessions.delete(oldest)
    }
  }

  getKnownSessionIds(): Set<string> {
    return this.knownSessions
  }


  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }


  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    return this.tasks.byParent(sessionID)
  }


  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const walk = (parentSessionID: string): void => {
      for (const child of this.tasks.byParent(parentSessionID)) {
        result.push(child)
        if (child.sessionID) walk(child.sessionID)
      }
    }
    walk(sessionID)
    return result
  }


  getNativeDescendants(sessionId: string): NativeDescendant[] {
    const cached = this.nativeDescCache.get(sessionId)
    if (cached && Date.now() - cached.at < NATIVE_CACHE_TTL_MS) return cached.rows
    const result: NativeDescendant[] = []
    try {
      const visited = new Set<string>([sessionId])
      const queue: string[] = [...getSubagentSessionIDs(sessionId)]
      for (const id of queue) visited.add(id)
      while (queue.length > 0) {
        const current = queue.shift() as string
        const parent = getParentSessionID(current)
        if (parent === undefined) continue
        result.push({
          sessionId: current,
          parentSessionId: parent,
          isChild: parent === sessionId,
        })
        for (const child of getSubagentSessionIDs(current)) {
          if (!visited.has(child)) {
            visited.add(child)
            queue.push(child)
          }
        }
      }
    } catch {
      return []
    }
    this.nativeDescCache.set(sessionId, { at: Date.now(), rows: result })
    return result
  }


  findBySession(sessionID: string): BackgroundTask | undefined {
    const hit = this.tasks.bySession(sessionID)
    if (hit) return hit
    if (!this.tasks.dirty) return undefined
    this.tasks.rebuild()
    return this.tasks.bySession(sessionID)
  }


  // Call immediately after in-place task.sessionID assignment; never use tasks.set
  // for this (it moves parentIndex order).
  reindexTask(task: BackgroundTask): void {
    this.tasks.reindexSession(task)
  }


  findDiskTaskBySession(sessionID: string): BackgroundTask | undefined {
    const wanted = ManagerStore.normalizeSessionID(sessionID)
    let handles: ReturnType<typeof readHandles>
    try {
      handles = readHandles(this.directory)
    } catch {
      return undefined
    }
    for (const handle of handles) {
      if (handle.sessionID === undefined) continue
      if (ManagerStore.normalizeSessionID(handle.sessionID) !== wanted) continue
      if (this.tasks.has(handle.taskId)) return this.tasks.get(handle.taskId)
      const uncertain = handle.status === "running" || handle.status === "pending"
      const task: BackgroundTask = {
        generation: handle.generation,
        id: handle.taskId,
        parentSessionID: handle.parentSessionID,
        parentMessageID: handle.parentMessageID,
        description: handle.description,
        prompt: "",
        agent: handle.agent,
        status: uncertain ? "statusUncertain" : handle.status,
        sessionID: handle.sessionID,
        terminalReason: uncertain ? "uncertain" : toRestoredReason(handle.terminalReason),
        queuedAt: handle.queuedAt !== undefined ? new Date(handle.queuedAt) : undefined,
        startedAt: handle.startedAt !== undefined ? new Date(handle.startedAt) : undefined,
        completedAt: handle.completedAt !== undefined ? new Date(handle.completedAt) : undefined,
        model: handle.model,
        category: handle.category,
        concurrencyGroup: handle.concurrencyGroup,
        origin: handle.origin,
      }
      this.tasks.set(task.id, task)
      return task
    }
    return undefined
  }


  disarmWallclock(taskId: string): void {
    this.wallclock.disarm(taskId)
  }

  taskTtlMs(): number {
    return this.config?.handleTtlMs ?? TASK_TTL_MS
  }


  persistHandle(task: BackgroundTask): void {
    task.lastActivityAt ??= new Date()
    try {
      writeHandle(this.directory, task)
    } catch (error) {
      log("[background-agent] Failed to persist background handle:", {
        taskId: task.id,
        error,
      })
    }
  }
  currentGeneration(taskId: string): number {
    return currentGeneration(this.directory, taskId)
  }
  persistHandleFenced(task: BackgroundTask, expectedGeneration: number): void {
    const persisted = readHandle(this.directory, task.id)?.generation ?? 0
    if (persisted !== expectedGeneration) {
      throw new StaleGenerationError(task.id, expectedGeneration, persisted)
    }
    task.generation = persisted
    task.lastActivityAt ??= new Date()
    writeHandle(this.directory, task)
  }
  bumpTaskGeneration(taskId: string): number {
    bumpGeneration(this.directory, taskId)
    return currentGeneration(this.directory, taskId)
  }

  /** Wake every waiter for `taskId` and drop the entry. */
  notifyTaskSettled(taskId: string): void {
    const waiters = this.taskSettledWaiters.get(taskId)
    if (waiters === undefined) return
    this.taskSettledWaiters.delete(taskId)
    for (const wake of [...waiters]) {
      try {
        wake()
      } catch (error) {
        log("[background-agent] Task-settled waiter failed:", error)
      }
    }
  }

  /**
   * Resolve when `taskId` settles, when `timeoutMs` elapses, or when
   * `signal` aborts — whichever comes first. A non-positive timeout or an
   * already-aborted signal resolves immediately. Never rejects.
   */
  waitForTaskSettled(
    taskId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    timers?: ManagerTimers,
  ): Promise<void> {
    if (timeoutMs <= 0 || signal?.aborted) return Promise.resolve()
    const clock = timers ?? DEFAULT_SETTLED_TIMERS
    return new Promise<void>((resolve) => {
      let settled = false
      let handle: ManagerTimerHandle | undefined
      const finish = (): void => {
        if (settled) return
        settled = true
        if (handle !== undefined) clock.clearTimeout(handle)
        signal?.removeEventListener("abort", finish)
        const waiters = this.taskSettledWaiters.get(taskId)
        if (waiters !== undefined) {
          waiters.delete(finish)
          if (waiters.size === 0) this.taskSettledWaiters.delete(taskId)
        }
        resolve()
      }
      const existing = this.taskSettledWaiters.get(taskId)
      const waiters = existing ?? new Set<() => void>()
      if (existing === undefined) this.taskSettledWaiters.set(taskId, waiters)
      waiters.add(finish)
      handle = clock.setTimeout(finish, timeoutMs)
      signal?.addEventListener("abort", finish, { once: true })
    })
  }
}
