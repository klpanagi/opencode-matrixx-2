import type { BackgroundTaskConfig, MatrixxConfig } from "../../../config/schema"
import type { V2Event } from "../../../plugin/tool/context"
import { log } from "../../../shared"
import { delay } from "../../../shared/runtime/delay"
import type {
  NativeDomains,
  NativePluginContext,
} from "../../../shared/session/session-context-source"
import { getTaskToastManager } from "../../task-toast-manager"
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
    void options
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
  handleEvent(event: V2Event): void {
    handleManagerEvent(this, event)
  }

  getKnownSessionIds(): Set<string> {
    return this.store.getKnownSessionIds()
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.store.getTask(id)
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

    task.status = "cancelled"
    task.completedAt = new Date()
    if (options?.reason) task.error = options.reason
    this.store.persistHandle(task)
    this.taskHistory.record(task.parentSessionID, {
      id: task.id,
      sessionID: task.sessionID,
      agent: task.agent,
      description: task.description,
      status: "cancelled",
      category: task.category,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    })

    if (abortSession && task.sessionID) {
      abortSessionQuietly(this.native, task.sessionID, "cancel")
    }

    const toastManager = getTaskToastManager()
    if (toastManager) toastManager.removeTask(task.id)
    log(`[background-agent] Task cancelled via ${source}:`, task.id)
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

    let pending = active()
    let natives = uncoveredNatives()
    while (
      (pending.length > 0 || natives.length > 0) &&
      Date.now() - startTime < timeoutMs
    ) {
      await delay(pollIntervalMs)
      pending = active()
      natives = uncoveredNatives()
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


  shutdown(): void {
    this.store.tasks.clear()
    this.store.nativeDescCache.clear()
    log("[background-agent] BackgroundManager shut down (native shim)")
  }
}
