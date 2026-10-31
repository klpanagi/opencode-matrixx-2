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
 */

import type { BackgroundTaskConfig, MatrixxConfig } from "../../config/schema"
import type { V2Event } from "../../plugin/context"
import { getAgentToolRestrictions, log } from "../../shared"
import { delay } from "../../shared/delay"
import { promptNativeWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import type {
  NativeDomains,
  NativePluginContext,
} from "../../shared/session-context-source"
import { setSessionTemperature, setSessionTools } from "../../shared/session-state"
import { getParentSessionID, getSubagentSessionIDs, registerSubagentSession } from "../session-state/state"
import { getTaskToastManager } from "../task-toast-manager"
import type {
  EventProperties,
  OnSubagentSessionCreated,
  SubagentSessionCreatedEvent,
} from "./constants"
import { TASK_TTL_MS } from "./constants"
import { getSessionErrorMessage } from "./error-helpers"
import {
  buildSubagentTitle,
  readHandles,
  sweepStaleHandles,
  writeHandle,
} from "./handle-index"
import {
  classifyRevivable,
  findRevivableHandle,
  type ReviveBlockReason,
  toReviveTask,
} from "./revive"
import { TaskHistory } from "./task-history"
import type {
  BackgroundTask,
  LaunchInput,
  ResumeInput,
  ReviveInput,
} from "./types"

/** Short-TTL cache for native descendant listings (T3). In-memory only. */
const NATIVE_CACHE_TTL_MS = 1000

export type {
  EventProperties,
  OnSubagentSessionCreated,
  SubagentSessionCreatedEvent,
}

/**
 * Ephemeral native session descriptor (T1 unified-bg-native-tracking).
 *
 * Read-only view over the session-state registry — NOT a persisted bg_
 * handle. Uses the lightweight `subagentSessions`/`subagentParentMap`
 * registry (getSubagentSessionIDs + getParentSessionID) rather than the
 * heavier storage.ts SDK read path (getMainSessions/getAllSessions),
 * which requires directory-scoped sqlite/JSON access.
 */
export interface NativeDescendant {
  sessionId: string
  parentSessionId: string
  isChild: boolean
}

export class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>()
  private nativeDescCache = new Map<string, { at: number; rows: NativeDescendant[] }>()
  private native: NativeDomains
  private directory: string
  private config?: BackgroundTaskConfig
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
    this.native = ctx
    this.directory = ctx.directory
    this.config = config
    void options
  }

  /**
   * Reload persisted handles for restart visibility. Persisted
   * `running|pending` handles are NOT probed against the host (no reconcile
   * loops); they reload as `statusUncertain` and stay revivable with force.
   */
  async restoreHandles(): Promise<void> {
    const swept = sweepStaleHandles(this.directory, this.taskTtlMs())
    const handles = readHandles(this.directory)

    let restored = 0
    for (const handle of handles) {
      if (this.tasks.has(handle.taskId)) continue
      const uncertain =
        handle.status === "running" || handle.status === "pending"
      this.tasks.set(handle.taskId, {
        id: handle.taskId,
        parentSessionID: handle.parentSessionID,
        parentMessageID: handle.parentMessageID,
        description: handle.description,
        prompt: "",
        agent: handle.agent,
        status: uncertain ? "statusUncertain" : handle.status,
        sessionID: handle.sessionID,
        terminalReason: uncertain ? "uncertain" : handle.terminalReason,
        queuedAt:
          handle.queuedAt !== undefined ? new Date(handle.queuedAt) : undefined,
        startedAt:
          handle.startedAt !== undefined ? new Date(handle.startedAt) : undefined,
        completedAt:
          handle.completedAt !== undefined
            ? new Date(handle.completedAt)
            : undefined,
        model: handle.model,
        category: handle.category,
        concurrencyGroup: handle.concurrencyGroup,
      })
      restored++
    }

    log("[background-agent] Restored background handles:", { restored, swept })
  }

  /**
   * Launch a subagent via the native session APIs: `session.create` with the
   * parent linkage, then a fire-and-forget `session.prompt`. No queues, no
   * semaphores, no tmux callbacks — saturation surfaces as a thrown error
   * from the host instead of a synthetic `queue-saturated` terminal state.
   */
  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionID,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    if (
      typeof input.description !== "string" ||
      input.description.trim() === ""
    ) {
      const fromPrompt =
        typeof input.prompt === "string" && input.prompt.trim() !== ""
          ? input.prompt.trim().split(/\s+/).slice(0, 5).join(" ")
          : ""
      input.description =
        fromPrompt !== "" ? fromPrompt.slice(0, 80) : "Background task"
    }

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      status: "pending",
      queuedAt: new Date(),
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      parentModel: input.parentModel,
      parentAgent: input.parentAgent,
      parentTools: input.parentTools,
      model: input.model,
      category: input.category,
    }

    this.tasks.set(task.id, task)
    this.taskHistory.record(input.parentSessionID, {
      id: task.id,
      agent: input.agent,
      description: task.description,
      status: "pending",
      category: input.category,
    })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: input.description,
        agent: input.agent,
        isBackground: true,
        status: "queued",
        skills: input.skills,
      })
    }

    let created: { id?: string }
    try {
      created = (await this.native.session.create({
        parentID: input.parentSessionID,
        title: buildSubagentTitle(input.description, input.agent),
        agent: input.agent,
        ...(input.model
          ? {
              model: {
                id: input.model.modelID,
                providerID: input.model.providerID,
                ...(input.model.variant !== undefined ? { variant: input.model.variant } : {}),
              },
            }
          : {}),
      })) as { id?: string }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      task.status = "error"
      task.error = `Failed to create background session: ${message}`
      task.completedAt = new Date()
      this.persistHandle(task)
      throw new Error(task.error)
    }

    if (!created.id) {
      task.status = "error"
      task.error =
        "Failed to create background session: API returned no session ID"
      task.completedAt = new Date()
      this.persistHandle(task)
      throw new Error(task.error)
    }

    const sessionID = created.id
    registerSubagentSession(sessionID, input.parentSessionID)

    task.status = "running"
    task.startedAt = new Date()
    task.sessionID = sessionID
    task.progress = { toolCalls: 0, lastUpdate: new Date() }
    this.persistHandle(task)
    this.taskHistory.record(input.parentSessionID, {
      id: task.id,
      sessionID,
      agent: input.agent,
      description: task.description,
      status: "running",
      category: input.category,
      startedAt: task.startedAt,
    })

    if (toastManager) toastManager.updateTask(task.id, "running")

    log("[background-agent] Launching task:", {
      taskId: task.id,
      sessionID,
      agent: input.agent,
    })

    if (input.model?.temperature !== undefined) {
      setSessionTemperature(sessionID, input.model.temperature)
    }

    this.firePrompt(task, input.prompt, input.skillContent).catch((error) => {
      log("[background-agent] prompt error:", error)
      task.status = "interrupt"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()
      this.persistHandle(task)
      this.abortSessionQuietly(sessionID, "error-recovery")
    })

    return task
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
    const existingTask = this.tasks.get(input.taskId)
    if (existingTask) {
      existingTask.parentSessionID = input.parentSessionID
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent
      }
      log("[background-agent] External task already registered:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
        status: existingTask.status,
      })
      return existingTask
    }

    const task: BackgroundTask = {
      id: input.taskId,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: "",
      description: input.description,
      prompt: "",
      agent: input.agent || "task",
      status: "running",
      startedAt: new Date(),
      progress: { toolCalls: 0, lastUpdate: new Date() },
      parentAgent: input.parentAgent,
    }

    this.tasks.set(task.id, task)
    this.persistHandle(task)
    registerSubagentSession(input.sessionID, input.parentSessionID)
    this.taskHistory.record(input.parentSessionID, {
      id: task.id,
      sessionID: input.sessionID,
      agent: task.agent,
      description: task.description,
      status: "running",
      startedAt: task.startedAt,
    })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: task.description,
        agent: task.agent,
        isBackground: true,
      })
    }

    log("[background-agent] Registered external task:", {
      taskId: task.id,
      sessionID: input.sessionID,
    })
    return task
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }
    if (!existingTask.sessionID) {
      throw new Error(`Task has no sessionID: ${existingTask.id}`)
    }
    if (existingTask.status === "running") {
      log("[background-agent] Resume skipped - task already running:", {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
      })
      return existingTask
    }

    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel
    existingTask.parentAgent = input.parentAgent
    if (input.parentTools) existingTask.parentTools = input.parentTools
    existingTask.startedAt = new Date()
    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }
    this.persistHandle(existingTask)

    registerSubagentSession(existingTask.sessionID, input.parentSessionID)

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: existingTask.id,
        description: existingTask.description,
        agent: existingTask.agent,
        isBackground: true,
      })
    }

    log("[background-agent] Resuming task:", {
      taskId: existingTask.id,
      sessionID: existingTask.sessionID,
    })

    this.firePrompt(existingTask, input.prompt).catch((error) => {
      log("[background-agent] resume prompt error:", error)
      existingTask.status = "interrupt"
      existingTask.error =
        error instanceof Error ? error.message : String(error)
      existingTask.completedAt = new Date()
      this.persistHandle(existingTask)
      if (existingTask.sessionID) {
        this.abortSessionQuietly(existingTask.sessionID, "resume-error")
      }
    })

    return existingTask
  }

  /** Revive a terminal task with a new prompt via native `session.prompt`. */
  async revive(input: ReviveInput): Promise<BackgroundTask> {
    const id = input.taskId ?? input.sessionId ?? ""
    let task =
      input.taskId !== undefined ? this.tasks.get(input.taskId) : undefined
    if (!task && input.sessionId !== undefined) {
      task = this.findBySession(input.sessionId)
    }
    if (task?.status === "running") {
      log("[background-agent] Revive skipped - task already running:", {
        taskId: task.id,
        sessionID: task.sessionID,
      })
      return task
    }
    const guidance: Record<ReviveBlockReason, string> = {
      active: `Task ${id} is still active; use background_output to inspect it.`,
      uncertain: `Task ${id} has unknown liveness; re-run with force: true to acknowledge this.`,
      "no-session": `Task ${id} has no session to revive (it never produced one).`,
      "unknown-task": `Task ${id} is not revivable (unrecognised state).`,
      expired: `Task ${id} expired: its handle was removed after the 30-minute retention window.`,
    }
    if (!task) {
      // Native ses_ sessions have no bg_ handles and can never be revived:
      // fail fast with guidance instead of the generic not-found error.
      if (
        input.sessionId !== undefined &&
        getParentSessionID(input.sessionId) !== undefined
      ) {
        throw new Error(
          `Cannot revive native session ${input.sessionId}: revive is bg_-only (background handles only). Use background_output/session_read to inspect it.`,
        )
      }
      const handle = findRevivableHandle(readHandles(this.directory), {
        taskId: input.taskId,
        sessionId: input.sessionId,
      })
      if (!handle) {
        throw new Error(
          `Task not found for revive: ${id}. It may have expired (handles are retained 30 minutes) or never existed.`,
        )
      }
      const handleEligibility = classifyRevivable(handle, {
        force: input.force,
      })
      if (!handleEligibility.eligible) {
        throw new Error(guidance[handleEligibility.reason])
      }
      task = toReviveTask(handle, input.prompt)
    } else {
      task.prompt = input.prompt
      const taskEligibility = classifyRevivable(task, { force: input.force })
      if (!taskEligibility.eligible) {
        throw new Error(guidance[taskEligibility.reason])
      }
    }
    if (!task.sessionID) throw new Error(`Task has no sessionID: ${task.id}`)
    const sessionID = task.sessionID

    task.status = "running"
    task.parentSessionID = input.parentSessionID
    task.parentMessageID = input.parentMessageID
    if (input.parentModel !== undefined) task.parentModel = input.parentModel
    if (input.parentAgent !== undefined) task.parentAgent = input.parentAgent
    if (input.parentTools !== undefined) task.parentTools = input.parentTools
    task.startedAt = new Date()
    task.completedAt = undefined
    task.error = undefined
    task.progress = {
      toolCalls: task.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }
    this.tasks.set(task.id, task)
    this.persistHandle(task)
    registerSubagentSession(sessionID, input.parentSessionID)
    this.taskHistory.record(task.parentSessionID, {
      id: task.id,
      sessionID,
      agent: task.agent,
      description: task.description,
      status: "running",
      startedAt: task.startedAt,
    })

    log("[background-agent] Reviving task:", { taskId: task.id })

    this.firePrompt(task, input.prompt).catch((error) => {
      log("[background-agent] revive prompt error:", error)
      task.status = "interrupt"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()
      this.persistHandle(task)
      this.abortSessionQuietly(sessionID, "revive-error")
    })

    return task
  }

  listRevivable(parentSessionID?: string): Array<{
    taskId: string
    description: string
    agent: string
    status: string
    sessionID: string
    terminalReason?: string
  }> {
    const seen = new Set<string>()
    const rows: Array<{
      taskId: string
      description: string
      agent: string
      status: string
      sessionID: string
      terminalReason?: string
      ts: number
    }> = []
    const consider = (
      id: string,
      parent: string,
      description: string,
      agent: string,
      status: string,
      sessionID: string | undefined,
      terminalReason: string | undefined,
      ts: number,
    ): void => {
      if (seen.has(id) || sessionID === undefined) return
      if (parentSessionID !== undefined && parent !== parentSessionID) return
      if (!classifyRevivable({ status, sessionID }, {}).eligible) return
      seen.add(id)
      rows.push({
        taskId: id,
        description,
        agent,
        status,
        sessionID,
        terminalReason,
        ts,
      })
    }
    for (const task of this.tasks.values()) {
      consider(
        task.id,
        task.parentSessionID,
        task.description,
        task.agent,
        task.status,
        task.sessionID,
        task.terminalReason,
        task.completedAt?.getTime() ??
          task.startedAt?.getTime() ??
          task.queuedAt?.getTime() ??
          0,
      )
    }
    for (const handle of readHandles(this.directory)) {
      consider(
        handle.taskId,
        handle.parentSessionID,
        handle.description,
        handle.agent,
        handle.status,
        handle.sessionID,
        handle.terminalReason,
        handle.completedAt ?? handle.startedAt ?? handle.queuedAt ?? 0,
      )
    }
    rows.sort((a, b) => b.ts - a.ts)
    return rows.map((row) => ({
      taskId: row.taskId,
      description: row.description,
      agent: row.agent,
      status: row.status,
      sessionID: row.sessionID,
      terminalReason: row.terminalReason,
    }))
  }

  /**
   * Native event routing (wired by the background-notification hook).
   * Completion is detected from native session lifecycle events only —
   * no polling, no reconcile probes.
   */
  /**
   * Normalize a raw session ID: trim surrounding whitespace and strip
   * query/hash suffixes so mismatched shapes still hit the same task.
   */
  private static normalizeSessionID(raw: string): string {
    const trimmed = raw.trim()
    const queryIndex = trimmed.indexOf("?")
    const withoutQuery =
      queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed
    const hashIndex = withoutQuery.indexOf("#")
    return hashIndex >= 0 ? withoutQuery.slice(0, hashIndex) : withoutQuery
  }

  handleEvent(event: V2Event): void {
    const props = (event.data as Record<string, unknown> | undefined) ?? {}
    const topLevelSessionID = (event as unknown as { sessionID?: unknown })
      .sessionID
    const rawSessionID =
      typeof props.sessionID === "string"
        ? props.sessionID
        : typeof topLevelSessionID === "string"
          ? topLevelSessionID
          : undefined
    log("[background-agent] handleEvent entry:", {
      type: event.type,
      sessionID: rawSessionID,
    })
    if (!rawSessionID) {
      log("[background-agent] handleEvent no-op: missing sessionID", {
        type: event.type,
      })
      return
    }
    const sessionID = BackgroundManager.normalizeSessionID(rawSessionID)
    const task = this.findBySession(sessionID)
    // Safe no-op for unmatched sessions, including ephemeral native ses_
    // descendants with no bg_ task: log and return, never create handles.
    if (!task || (task.status !== "running" && task.status !== "pending")) {
      log("[background-agent] handleEvent no-op: unknown or non-active session", {
        type: event.type,
        sessionID,
      })
      return
    }

    if (event.type === "session.idle") {
      task.status = "completed"
      task.completedAt = new Date()
      this.nativeDescCache.clear()
      this.persistHandle(task)
      this.taskHistory.record(task.parentSessionID, {
        id: task.id,
        sessionID: task.sessionID,
        agent: task.agent,
        description: task.description,
        status: "completed",
        category: task.category,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      })
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task completed (native session.idle):", task.id)
      return
    }

    if (event.type === "session.error") {
      task.status = "error"
      task.error =
        getSessionErrorMessage(props as EventProperties) ??
        "Session reported an error"
      task.completedAt = new Date()
      this.nativeDescCache.clear()
      this.persistHandle(task)
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task errored (native session.error):", task.id)
      return
    }

    if (event.type === "session.execution.succeeded") {
      task.status = "completed"
      task.completedAt = new Date()
      this.nativeDescCache.clear()
      this.persistHandle(task)
      this.taskHistory.record(task.parentSessionID, {
        id: task.id,
        sessionID: task.sessionID,
        agent: task.agent,
        description: task.description,
        status: "completed",
        category: task.category,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      })
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task completed (native session.execution.succeeded):", task.id)
      return
    }

    if (event.type === "session.execution.failed") {
      task.status = "error"
      task.error =
        getSessionErrorMessage(props as EventProperties) ??
        "Session reported an error"
      task.completedAt = new Date()
      this.nativeDescCache.clear()
      this.persistHandle(task)
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task errored (native session.execution.failed):", task.id)
      return
    }

    log("[background-agent] handleEvent ignored non-idle event:", {
      type: event.type,
      taskId: task.id,
    })
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) result.push(task)
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)
    for (const child of directChildren) {
      result.push(child)
      if (child.sessionID) {
        result.push(...this.getAllDescendantTasks(child.sessionID))
      }
    }
    return result
  }

  /**
   * Read-only native descendants of a session (T1).
   *
   * Walks the ephemeral session-state registry: a native ses_ session
   * counts as a descendant when its ancestor chain (via getParentSessionID)
   * includes `sessionId`. Returns ephemeral descriptors only — no handle
   * writes, no persistence. Cycle-guarded with a visited set (the older
   * getAllDescendantTasks lacks one). Returns [] for unknown sessions.
   */
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
    const wanted = BackgroundManager.normalizeSessionID(sessionID)
    for (const task of this.tasks.values()) {
      if (
        task.sessionID !== undefined &&
        BackgroundManager.normalizeSessionID(task.sessionID) === wanted
      )
        return task
    }
    return undefined
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
    const task = this.tasks.get(taskId)
    if (!task || (task.status !== "running" && task.status !== "pending")) {
      return false
    }

    const source = options?.source ?? "cancel"
    const abortSession = options?.abortSession !== false

    task.status = "cancelled"
    task.completedAt = new Date()
    if (options?.reason) task.error = options.reason
    this.persistHandle(task)
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
      this.abortSessionQuietly(task.sessionID, "cancel")
    }

    const toastManager = getTaskToastManager()
    if (toastManager) toastManager.removeTask(task.id)
    log(`[background-agent] Task cancelled via ${source}:`, task.id)
    return true
  }

  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (task?.status !== "pending") return false
    void this.cancelTask(taskId, {
      source: "cancelPendingTask",
      abortSession: false,
    })
    return true
  }

  cancelAllForSession(parentSessionID: string): number {
    const toCancel: string[] = []
    for (const task of this.tasks.values()) {
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
      this.getAllDescendantTasks(sessionID).filter(
        (t) => t.status === "running" || t.status === "pending",
      )
    // Ephemeral native view: ses_ descendants with no covering bg_ task
    // count as pending-equivalent so the wait does not false-complete.
    // Read-only — never written to this.tasks or persisted.
    const uncoveredNatives = (): NativeDescendant[] => {
      try {
        return this.getNativeDescendants(sessionID).filter(
          (n) => !this.findBySession(n.sessionId),
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
    for (const task of this.getAllDescendantTasks(sessionID)) {
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
    this.tasks.clear()
    this.nativeDescCache.clear()
    log("[background-agent] BackgroundManager shut down (native shim)")
  }

  private taskTtlMs(): number {
    return this.config?.handleTtlMs ?? TASK_TTL_MS
  }

  private persistHandle(task: BackgroundTask): void {
    try {
      writeHandle(this.directory, task)
    } catch (error) {
      log("[background-agent] Failed to persist background handle:", {
        taskId: task.id,
        error,
      })
    }
  }

  private abortSessionQuietly(sessionID: string, context?: string): void {
    this.native.session.interrupt({ sessionID }).catch((err) => {
      log(
        `[background-agent] Session abort failed${context ? ` (${context})` : ""}:`,
        { sessionID, error: err },
      )
    })
  }

  /** Fire-and-forget native prompt with the task's agent/model/tool scope. */
  private async firePrompt(
    task: BackgroundTask,
    prompt: string,
    skillContent?: string,
  ): Promise<void> {
    const sessionID = task.sessionID
    if (!sessionID) throw new Error(`Task has no sessionID: ${task.id}`)
    const tools = {
      task: true,
      question: false,
      ...getAgentToolRestrictions(task.agent),
    }
    setSessionTools(sessionID, tools)

    // Native v2 session.prompt takes { sessionID, text } only: agent and model
    // are pinned at session.create above, tools flow through setSessionTools,
    // and skill content is prepended to the user text so the child receives it.
    const fireText =
      skillContent !== undefined && skillContent.length > 0 ? `${skillContent}\n\n${prompt}` : prompt
    await promptNativeWithModelSuggestionRetry(this.native.session, {
      sessionID,
      text: fireText,
    })
  }
}

/**
 * Test-only reset hook (D5 native migration): the pre-migration in-memory
 * prune throttle was removed — stale-handle expiry is now the throttle-free TTL sweep in
 * `handle-index.ts` (`sweepStaleHandles`, invoked per operation). Kept as a
 * no-op so `tests/test-setup.ts` and older prune-throttle tests keep loading.
 */
export function _resetPruneThrottleForTesting(): void {
  // No-op: no prune throttle state remains to reset.
}
