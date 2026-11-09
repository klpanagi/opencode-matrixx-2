import type { BackgroundTaskConfig, MatrixxConfig } from "../../../config/schema"
import type { EffortConfig } from "../../../config/schema/effort"
import type { V2Event } from "../../../plugin/tool/context"
import { log } from "../../../shared"
import { delay } from "../../../shared/runtime/delay"
import type {
  NativeDomains,
  NativePluginContext,
} from "../../../shared/session/session-context-source"
import type {
  EventProperties,
  OnSubagentSessionCreated,
  SubagentSessionCreatedEvent,
} from "../constants"
import { TaskHistory } from "../task-history"
import type {
  BackgroundTask,
  LaunchInput,
  ResumeInput,
  ReviveInput,
} from "../types"
import { finalizeTask } from "./finalize"
import {
  abortSessionQuietly,
  launchTask,
  restoreHandles,
  resumeTask,
  trackTask,
} from "./lifecycle"
import {
  handleManagerEvent,
  listRevivable,
  reviveTask,
} from "./reconcile"
import { ManagerStore } from "./store"
import type { ManagerRuntime, NativeDescendant } from "./types"

export type {
  EventProperties,
  OnSubagentSessionCreated,
  SubagentSessionCreatedEvent,
}

/**
 * Native v2 background-task shim (D5).
 *
 * Replaces the custom orchestration that lived here (~2455 LOC: polling
 * loops, concurrency semaphores, queue admission, restart handling,
 * wake-scheduler, wall-clock supervisor, tmux pane callbacks, parent
 * notification pipeline) with a thin wrapper over the native session APIs:
 *
 * - native `session.create` + `session.prompt` for launches
 * - Native `session.idle` / `session.error` events (via `handleEvent`) for
 *   completion detection — no polling loops, no reconcile probes
 * - native `session.interrupt` for cancellation
 * - File-backed handles (`handle-index`) for restart visibility only —
 *   persisted `running|pending` handles reload as `statusUncertain`,
 *   revivable with `force: true`
 *
 * Deleted (D5): the reconciler, admission classifier, wake-scheduler and every
 * tmux spawn wired through `setup-domains` `onSubagentSessionCreated`.
 * Kept intentionally: `handle-index.ts` (restart visibility), `revive.ts`
 * (pure eligibility logic), `task-history.ts` (compaction context),
 * `types.ts` / `constants.ts` (shapes). The interactive-bash tool and the
 * doctor `tmux-integration` check keep their own tmux binary usage.
 *
 * The class below is the composing control surface: it owns the
 * `ManagerStore` and delegates lifecycle work to `lifecycle.ts` and
 * event-driven consistency to `reconcile.ts`. Method bodies there are the
 * original statements with the receiver spelled `rt` instead of `this`.
 */
export class BackgroundManager implements ManagerRuntime {
  readonly store: ManagerStore
  readonly native: NativeDomains
  readonly directory: string
  readonly config?: BackgroundTaskConfig
  readonly effortConfig?: EffortConfig
  readonly taskHistory = new TaskHistory()

  constructor(
    ctx: NativePluginContext,
    config?: BackgroundTaskConfig,
    options?: {
      /** @deprecated Native session events own display; ignored. */
      onSubagentSessionCreated?: OnSubagentSessionCreated
      onShutdown?: () => void
      /** Full plugin config — supplies the `tasks.*` store location. */
      pluginConfig?: Partial<MatrixxConfig>
    },
  ) {
    this.store = new ManagerStore(ctx.directory, config)
    this.native = ctx
    this.directory = ctx.directory
    this.config = config
    this.effortConfig = options?.pluginConfig?.effort
  }

  /**
   * Legacy direct-state access: the live task registry.
   * Tests and benches reach into `manager.tasks`; the getter keeps that
   * working while the store owns the map.
   */
  get tasks(): Map<string, BackgroundTask> {
    return this.store.tasks
  }

  /**
   * Reload persisted handles for restart visibility. Persisted
   * `running|pending` handles are NOT probed against the host (no reconcile
   * loops); they reload as `statusUncertain` and stay revivable with force.
   */
  async restoreHandles(): Promise<void> {
    return restoreHandles(this)
  }

  /**
   * Launch a subagent via the native session APIs: `session.create` with the
   * parent linkage, then a fire-and-forget `session.prompt`. No queues, no
   * semaphores, no tmux callbacks — saturation surfaces as a thrown error
   * from the host instead of a synthetic `queue-saturated` terminal state.
   */
  async launch(
    input: LaunchInput & {
      sessionId?: string
      sessionID?: string
      messageId?: string
      messageID?: string
    },
  ): Promise<BackgroundTask> {
    return launchTask(this, input)
  }

  /**
   * Track a task created elsewhere (e.g. via the native task tool) for
   * notification/toast bookkeeping.
   */
  async trackTask(input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    return trackTask(this, input)
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    return resumeTask(this, input)
  }

  /** Revive a terminal task with a new prompt via native `session.prompt`. */
  async revive(input: ReviveInput): Promise<BackgroundTask> {
    return reviveTask(this, input)
  }

  listRevivable(parentSessionID?: string): ReturnType<typeof listRevivable> {
    return listRevivable(this, parentSessionID)
  }

  /**
   * Native event routing (wired by the background-notification hook).
   * Completion is detected from native session lifecycle events only —
   * no polling, no reconcile probes.
   */
  async handleEvent(event: V2Event): Promise<void> {
    return handleManagerEvent(this, event)
  }

  getKnownSessionIds(): Set<string> {
    return this.store.getKnownSessionIds()
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.store.getTask(id)
  }

  persistHandleFenced(task: BackgroundTask, expectedGeneration: number): void {
    this.store.persistHandleFenced(task, expectedGeneration)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    return this.store.getTasksByParentSession(sessionID)
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    return this.store.getAllDescendantTasks(sessionID)
  }

  getNativeDescendants(sessionId: string): ReturnType<ManagerStore["getNativeDescendants"]> {
    return this.store.getNativeDescendants(sessionId)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    return this.store.findBySession(sessionID)
  }

  findDiskTaskBySession(sessionID: string): BackgroundTask | undefined {
    return this.store.findDiskTaskBySession(sessionID)
  }

  async cancelTask(
    taskId: string,
    options?: {
      source?: string
      reason?: string
      abortSession?: boolean
      skipNotification?: boolean
    },
  ): Promise<boolean> {
    const task = this.store.tasks.get(taskId)
    if (!task || (task.status !== "running" && task.status !== "pending")) {
      return false
    }

    const source = options?.source ?? "cancel"
    const abortSession = options?.abortSession !== false

    await finalizeTask(this, task, {
      status: "cancelled",
      source,
      notify: false,
      removeToast: true,
      recordHistory: true,
      ...(options?.reason !== undefined ? { incomingError: options.reason } : {}),
      logMessage: `[background-agent] Task cancelled via ${source}:`,
    })

    if (abortSession && task.sessionID) {
      abortSessionQuietly(this.native, task.sessionID, "cancel")
    }

    this.rejectWaiters(
      task.parentSessionID,
      new Error(`Task cancelled: ${taskId}`),
    )
    return true
  }


  cancelPendingTask(taskId: string): boolean {
    const task = this.store.tasks.get(taskId)
    if (task?.status !== "pending") return false
    void this.cancelTask(taskId, {
      source: "cancelPendingTask",
      abortSession: false,
    })
    return true
  }


  cancelAllForSession(parentSessionID: string): number {
    const toCancel: string[] = []
    for (const task of this.store.tasks.values()) {
      if (
        task.parentSessionID === parentSessionID &&
        (task.status === "pending" || task.status === "running")
      ) {
        toCancel.push(task.id)
      }
    }
    for (const taskId of toCancel) {
      void this.cancelTask(taskId, {
        source: "stop-continuation",
        skipNotification: true,
      })
    }
    return toCancel.length
  }


  async waitForAllDescendants(
    sessionID: string,
    timeoutMs = 30000,
    pollIntervalMs = 1000,
    options?: { signal?: AbortSignal },
  ): Promise<{
    completed: Array<{
      id: string
      description: string
      agent: string
      status: string
    }>
    timedOut: Array<{
      id: string
      description: string
      agent: string
      status: string
    }>
  }> {
    const startTime = Date.now()
    const active = (): BackgroundTask[] =>
      this.store.getAllDescendantTasks(sessionID).filter(
        (t) => t.status === "running" || t.status === "pending",
      )
    // Ephemeral native view: ses_ descendants with no covering bg_ task
    // count as pending-equivalent so the wait does not false-complete.
    // Read-only — never written to this.store.tasks or persisted.
    const uncoveredNatives = (): NativeDescendant[] => {
      try {
        return this.store.getNativeDescendants(sessionID).filter(
          (n) => !this.store.findBySession(n.sessionId),
        )
      } catch {
        return []
      }
    }

    let rejectWait: ((err: unknown) => void) | undefined
    const abortPromise = new Promise<never>((_, reject) => {
      rejectWait = reject
    })
    const entry = {
      sessionID,
      reject: (err: unknown) => rejectWait?.(err),
    }
    this.store.waiters.add(entry)
    try {
      const signal = options?.signal
      if (signal?.aborted) throw signal.reason ?? new Error("Wait cancelled")
      const onSignalAbort = (): void => {
        rejectWait?.(signal?.reason ?? new Error("Wait cancelled"))
      }
      signal?.addEventListener("abort", onSignalAbort, { once: true })
      try {
        let pending = active()
        let natives = uncoveredNatives()
        while (
          (pending.length > 0 || natives.length > 0) &&
          Date.now() - startTime < timeoutMs
        ) {
          await Promise.race([delay(pollIntervalMs), abortPromise])
          pending = active()
          natives = uncoveredNatives()
        }
      } finally {
        signal?.removeEventListener("abort", onSignalAbort)
      }
    } finally {
      this.store.waiters.delete(entry)
    }

    const completed: Array<{
      id: string
      description: string
      agent: string
      status: string
    }> = []
    const timedOut: Array<{
      id: string
      description: string
      agent: string
      status: string
    }> = []
    for (const task of this.store.getAllDescendantTasks(sessionID)) {
      const row = {
        id: task.id,
        description: task.description,
        agent: task.agent,
        status: task.status,
      }
      if (task.status === "running" || task.status === "pending") {
        timedOut.push(row)
      } else {
        completed.push(row)
      }
    }
    // Surface still-uncovered natives as ephemeral timedOut rows so
    // background_wait_all observes them without any handle writes.
    for (const n of uncoveredNatives()) {
      timedOut.push({
        id: n.sessionId,
        description: `(native) ${n.sessionId}`,
        agent: "native",
        status: "running",
      })
    }
    return { completed, timedOut }
  }


  waiterCount(): number {
    return this.store.waiters.size
  }

  rejectWaiters(sessionID: string | undefined, err: unknown): void {
    for (const entry of [...this.store.waiters]) {
      if (sessionID !== undefined && entry.sessionID !== sessionID) continue
      try {
        entry.reject(err)
      } catch (error) {
        log("[background-agent] Waiter reject failed:", error)
      }
    }
  }

  shutdown(): void {
    this.rejectWaiters(undefined, new Error("BackgroundManager shut down"))
    this.store.waiters.clear()
    this.store.wallclock.disarmAll()
    this.store.tasks.clear()
    this.store.nativeDescCache.clear()
    log("[background-agent] BackgroundManager shut down (native shim)")
  }

  shutdownWithDeadline(deadlineMs = 5000): {
    forced: boolean
    abandoned: string[]
  } {
    const abandoned: string[] = []
    for (const task of this.store.tasks.values()) {
      if (task.status === "running" || task.status === "pending") {
        abandoned.push(task.id)
      }
    }
    this.rejectWaiters(undefined, new Error("BackgroundManager shut down"))
    this.store.waiters.clear()
    this.store.wallclock.disarmAll()
    this.store.tasks.clear()
    this.store.nativeDescCache.clear()
    if (abandoned.length > 0) {
      log("[background-agent] Shutdown deadline exceeded, forcing teardown", {
        abandoned,
        deadlineMs,
        code: "DeadlineExceeded",
      })
      return { forced: true, abandoned }
    }
    log("[background-agent] BackgroundManager shut down (native shim)")
    return { forced: false, abandoned: [] }
  }
}
