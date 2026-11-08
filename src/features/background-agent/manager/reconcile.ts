import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import type { V2Event } from "../../../plugin/tool/context"
import { isNativeSessionId, log } from "../../../shared"
import { promptNativeWithModelSuggestionRetry } from "../../../shared/model/model-suggestion-retry"
import { recordEffortForBackground } from "../../agent-effort/background"
import { getParentSessionID, registerSubagentSession } from "../../session-state/state"
import { getTaskToastManager } from "../../task-toast-manager"
import type { EventProperties } from "../constants"
import { getSessionErrorMessage } from "../error-helpers"
import { BG_HANDLE_FILE_PREFIX, getBgHandleDir, readHandles } from "../handle-index"
import { buildCompletionNotification } from "../notification-builder"
import {
  classifyRevivable,
  findRevivableHandle,
  isCorruptHandleValue,
  probeReviveTarget,
  type ReviveBlockReason,
  toReviveTask,
} from "../revive"
import type { BackgroundTask, ReviveInput } from "../types"
import { abortSessionQuietly, firePrompt } from "./lifecycle"
import type { BackgroundManager } from "./manager"
import { ManagerStore } from "./store"
import type { ManagerRuntime, ResolveAnyResult } from "./types"

/**
 * Event-driven consistency: revive, revivable listing, native event
 * routing, and any-id resolution (`resolveAny`).
 *
 * Same receiver-free shape as `lifecycle.ts`: functions take
 * `ManagerRuntime` (or the manager's public surface for `resolveAny`),
 * keeping `BackgroundManager` the sole owner of class state.
 */


const SESSION_LIST_TTL_MS = 30000
let sessionListCache: { at: number; ids: string[] } | null = null


/**
 * B11 minimal gate: quarantine corrupt handle files before revival.
 *
 * Links the B7 error contract (`StorageCorruptError` in task-storage):
 * unreadable or shape-invalid `bg_*.json` files are renamed aside to
 * `<name>.corrupt` + logged (never deleted, never crash revival).
 * Best-effort: individual failures are logged and skipped.
 */
export function quarantineCorruptHandles(directory: string): number {
  const dir = getBgHandleDir(directory)
  if (!existsSync(dir)) return 0
  let quarantined = 0
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(BG_HANDLE_FILE_PREFIX) || !name.endsWith(".json")) continue
    const filePath = join(dir, name)
    let value: unknown
    try {
      value = JSON.parse(readFileSync(filePath, "utf-8"))
    } catch (error) {
      value = undefined
      log("[background-agent] Revive quarantining unreadable handle:", {
        filePath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    if (value === undefined || isCorruptHandleValue(value)) {
      if (value !== undefined) {
        log("[background-agent] Revive quarantining corrupt handle:", { filePath })
      }
      try {
        renameSync(filePath, `${filePath}.corrupt`)
        quarantined++
      } catch (error) {
        log("[background-agent] Revive quarantine failed:", {
          filePath,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return quarantined
}

export async function reviveTask(rt: ManagerRuntime,input: ReviveInput): Promise<BackgroundTask> {
    const id = input.taskId ?? input.sessionId ?? ""
    let expectedGeneration: number | undefined
    let task =
      input.taskId !== undefined ? rt.store.tasks.get(input.taskId) : undefined
    if (!task && input.sessionId !== undefined) {
      task = rt.store.findBySession(input.sessionId)
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
      quarantineCorruptHandles(rt.directory)
      const handle = findRevivableHandle(readHandles(rt.directory), {
        taskId: input.taskId,
        sessionId: input.sessionId,
      })
      if (!handle) {
        const candidate = input.sessionId ?? input.taskId
        if (candidate !== undefined && isNativeSessionId(candidate)) {
          // A ses_ id with no bg_ handle is a native session: revivable only
          // by its owning parent via session.prompt. A foreign parent gets an
          // ownership-mismatch refusal; no mapping keeps the bg_-only refusal
          // (irreducible case: no session, no ownership).
          const owner = getParentSessionID(candidate)
          if (owner !== undefined && owner === input.parentSessionID) {
            await promptNativeWithModelSuggestionRetry(rt.native.session, {
              sessionID: candidate,
              text: input.prompt,
            })
            return {
              id: candidate,
              sessionID: candidate,
              parentSessionID: input.parentSessionID,
              parentMessageID: input.parentMessageID,
              description: `native session ${candidate}`,
              prompt: input.prompt,
              agent: "native",
              status: "running",
              startedAt: new Date(),
            } satisfies BackgroundTask
          }
          if (owner !== undefined) {
            throw new Error(
              `Cannot revive native session ${candidate}: owned by another parent session (ownership mismatch). Only the owning parent can re-prompt it.`,
            )
          }
          throw new Error(
            `Cannot revive native session ${candidate}: revive is bg_-only (background handles only). Use background_output/session_read to inspect it.`,
          )
        }
        throw new Error(
          `Task not found for revive: ${id}. It may have expired (handles are retained 30 minutes) or never existed.`,
        )
      }
      const handleEligibility = classifyRevivable(handle, {
        force: input.force,
      })
      if (!handleEligibility.eligible) {
        log("[background-agent] Revive skipped - handle not revivable:", {
          taskId: handle.taskId,
          reason: handleEligibility.reason,
        })
        throw new Error(guidance[handleEligibility.reason])
      }
      task = toReviveTask(handle, input.prompt)
      expectedGeneration = handle.generation
    } else {
      const taskEligibility = classifyRevivable(task, { force: input.force })
      if (!taskEligibility.eligible) {
        log("[background-agent] Revive skipped - task not revivable:", {
          taskId: task.id,
          reason: taskEligibility.reason,
        })
        throw new Error(guidance[taskEligibility.reason])
      }
      task.prompt = input.prompt
      expectedGeneration = task.generation
    }
    if (!task.sessionID) throw new Error(`Task has no sessionID: ${task.id}`)
    const sessionID = task.sessionID

    const probe = probeReviveTarget(
      rt.directory,
      { taskId: task.id, sessionID, generation: expectedGeneration },
      { expectedGeneration },
    )
    if (!probe.alive) {
      log("[background-agent] Revive probe failed - target dead, not resurrecting:", {
        taskId: task.id,
        reason: probe.reason,
      })
      throw probe.error
    }

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
    rt.store.tasks.set(task.id, task)
    task.generation = rt.store.bumpTaskGeneration(task.id)
    rt.store.persistHandle(task)
    registerSubagentSession(sessionID, input.parentSessionID)
    rt.taskHistory.record(task.parentSessionID, {
      id: task.id,
      sessionID,
      agent: task.agent,
      description: task.description,
      status: "running",
      startedAt: task.startedAt,
    })

    log("[background-agent] Reviving task:", { taskId: task.id })

    firePrompt(rt.native, task, input.prompt).catch((error) => {
      log("[background-agent] revive prompt error:", error)
      task.status = "interrupt"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()
      rt.store.persistHandle(task)
      abortSessionQuietly(rt.native, sessionID, "revive-error")
    })

    return task
}


export function listRevivable(rt: ManagerRuntime,parentSessionID?: string): Array<{
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
    for (const task of rt.store.tasks.values()) {
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
    for (const handle of readHandles(rt.directory)) {
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


function formatParentNotificationDuration(task: BackgroundTask): string {
  if (!task.startedAt) return "unknown"
  const end = task.completedAt ?? new Date()
  const seconds = Math.max(0, Math.round((end.getTime() - task.startedAt.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function deliverParentNotification(
  rt: ManagerRuntime,
  task: BackgroundTask,
  effortLine?: string | null,
): void {
  const parentSessionID = task.parentSessionID
  if (!parentSessionID) return
  try {
    const siblings = rt.store.getTasksByParentSession(parentSessionID)
    const remainingCount = siblings.filter(
      (t) => t.id !== task.id && (t.status === "running" || t.status === "pending"),
    ).length
    const completedTasks = siblings.filter(
      (t) => t.status !== "running" && t.status !== "pending",
    )
    const text = buildCompletionNotification(
      task,
      remainingCount === 0,
      completedTasks,
      remainingCount,
      formatParentNotificationDuration(task),
      `${task.error ? `\n**Error:** ${task.error}` : ""}${effortLine ? `\n\n${effortLine}` : ""}`,
    )
    rt.native.session.prompt({ sessionID: parentSessionID, text }).catch((error) => {
      log("[background-agent] parent notification failed:", error)
    })
  } catch (error) {
    log("[background-agent] parent notification failed:", error)
  }
}


export async function handleManagerEvent(rt: ManagerRuntime,event: V2Event): Promise<void> {
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
    const sessionID = ManagerStore.normalizeSessionID(rawSessionID)
    let task = rt.store.findBySession(sessionID)
    if (!task) {
      const owner = getParentSessionID(sessionID)
      if (owner !== undefined) {
        const cancelledSibling = [...rt.store.tasks.values()].some(
          (t) =>
            t.status === "cancelled" &&
            t.parentSessionID === owner &&
            t.concurrencyKey?.startsWith(`${owner}:`),
        )
        if (cancelledSibling) {
          log("[background-agent] Auto-track skipped: cancelled sibling with same concurrencyKey", {
            sessionID,
            parentSessionID: owner,
          })
          return
        }
        const covered = [...rt.store.tasks.values()].find(
          (candidate) =>
            candidate.sessionID !== undefined &&
            candidate.parentSessionID === owner &&
            ManagerStore.normalizeSessionID(candidate.sessionID) === sessionID,
        )
        if (covered !== undefined) {
          log("[background-agent] Auto-track suppressed: session already covered", {
            sessionID,
            taskId: covered.id,
            status: covered.status,
          })
          rt.store.reindexTask(covered)
          task = covered
        } else {
          const auto: BackgroundTask = {
            id: `bg_${crypto.randomUUID().slice(0, 8)}`,
            parentSessionID: owner,
            parentMessageID: "",
            description: `tracked native session ${sessionID}`,
            prompt: "",
            agent: "native",
            status: "running",
            startedAt: new Date(),
            sessionID,
          }
          rt.store.tasks.set(auto.id, auto)
          rt.store.knownSessions.add(sessionID)
          rt.store.persistHandle(auto)
          log("[background-agent] Auto-tracked native session:", { sessionID, taskId: auto.id })
          task = auto
        }
      }
    }
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
      rt.store.wallclock.disarm(task.id)
      rt.store.nativeDescCache.clear()
      rt.store.persistHandle(task)
      rt.taskHistory.record(task.parentSessionID, {
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
      const effort = await recordEffortForBackground(rt, task, rt.effortConfig)
      deliverParentNotification(rt, task, effort?.line)
      return
    }

    if (event.type === "session.error") {
      task.status = "error"
      task.error =
        getSessionErrorMessage(props as EventProperties) ??
        "Session reported an error"
      task.completedAt = new Date()
      rt.store.wallclock.disarm(task.id)
      rt.store.nativeDescCache.clear()
      rt.store.persistHandle(task)
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task errored (native session.error):", task.id)
      const effort = await recordEffortForBackground(rt, task, rt.effortConfig)
      deliverParentNotification(rt, task, effort?.line)
      return
    }

    if (event.type === "session.execution.succeeded") {
      task.status = "completed"
      task.completedAt = new Date()
      rt.store.wallclock.disarm(task.id)
      rt.store.nativeDescCache.clear()
      rt.store.persistHandle(task)
      rt.taskHistory.record(task.parentSessionID, {
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
      const effort = await recordEffortForBackground(rt, task, rt.effortConfig)
      deliverParentNotification(rt, task, effort?.line)
      return
    }

    if (event.type === "session.execution.failed") {
      task.status = "error"
      task.error =
        getSessionErrorMessage(props as EventProperties) ??
        "Session reported an error"
      task.completedAt = new Date()
      rt.store.wallclock.disarm(task.id)
      rt.store.nativeDescCache.clear()
      rt.store.persistHandle(task)
      const toastManager = getTaskToastManager()
      if (toastManager) toastManager.removeTask(task.id)
      log("[background-agent] Task errored (native session.execution.failed):", task.id)
      const effort = await recordEffortForBackground(rt, task, rt.effortConfig)
      deliverParentNotification(rt, task, effort?.line)
      return
    }

    log("[background-agent] handleEvent ignored non-idle event:", {
      type: event.type,
      taskId: task.id,
    })
}


export async function resolveAny(
  manager: BackgroundManager,
  id: string,
): Promise<ResolveAnyResult> {
  const raw = id.trim()
  const bgTask = manager.getTask(raw)
  if (bgTask !== undefined) return { origin: "bg", task: bgTask }
  const covered = manager.findBySession(raw)
  if (covered !== undefined) return { origin: "bg", task: covered }
  try {
    const onDisk = manager.findDiskTaskBySession?.(raw)
    if (onDisk !== undefined) return { origin: "bg", task: onDisk }
  } catch {
  }
  if (!raw.startsWith("ses_")) return { error: "not_found", id: raw }
  const native = (manager as unknown as { native?: { session?: unknown } }).native
  const session = native?.session as
    | {
        messages?: (args: { sessionID: string }) => Promise<unknown>
        get?: (args: { sessionID: string }) => Promise<unknown>
        list?: (query?: unknown) => Promise<unknown>
      }
    | undefined
  if (session?.messages !== undefined || session?.get !== undefined) {
    try {
      let messages: unknown
      if (session.messages !== undefined) {
        messages = await session.messages({ sessionID: raw })
      } else if (session.get !== undefined) {
        messages = await session.get({ sessionID: raw })
      }
      if (messages !== undefined && messages !== null) {
        const known = manager.getKnownSessionIds()
        const origin = known.has(raw) ? "ses" : "ses"
        return { origin, sessionId: raw, output: messages, messages }
      }
    } catch {
      // Fall through to bounded list sweep below.
    }
  }
  const swept = await backfillKnownSessions(manager)
  if (swept.includes(raw)) return { origin: "foreign", sessionId: raw, output: [] }
  return { error: "not_found", id: raw }
}


async function backfillKnownSessions(manager: BackgroundManager): Promise<string[]> {
  const now = Date.now()
  if (sessionListCache !== null && now - sessionListCache.at < SESSION_LIST_TTL_MS) {
    return sessionListCache.ids
  }
  const native = (manager as unknown as { native?: { session?: unknown } }).native
  const session = native?.session as
    | { list?: (query?: unknown) => Promise<unknown> }
    | undefined
  let ids: string[] = []
  if (session?.list !== undefined) {
    try {
      const rows = (await session.list()) as
        | Array<{ id?: string; sessionID?: string; sessionId?: string }>
        | { sessions?: Array<{ id?: string }> }
        | unknown
      const arr = Array.isArray(rows)
        ? rows
        : Array.isArray((rows as { sessions?: unknown }).sessions)
          ? (rows as { sessions: Array<{ id?: string }> }).sessions
          : []
      ids = arr
        .map((r) => r.id ?? r.sessionID ?? r.sessionId ?? "")
        .filter((v) => typeof v === "string" && v.startsWith("ses_"))
    } catch {
      ids = []
    }
  }
  sessionListCache = { at: now, ids }
  return ids
}


export function listKnownSessions(manager: BackgroundManager): {
  bgPending: string[]
  liveSes: string[]
} {
  const bgPending: string[] = []
  const seen = new Set<string>()
  const tasks = (manager as unknown as { tasks?: Map<string, { id: string; status: string }> }).tasks
  if (tasks !== undefined) {
    for (const task of tasks.values()) {
      if ((task.status === "pending" || task.status === "running") && !seen.has(task.id)) {
        seen.add(task.id)
        bgPending.push(task.id)
      }
    }
  }
  const liveSes = [...manager.getKnownSessionIds()]
  return { bgPending, liveSes }
}


export function _resetPruneThrottleForTesting(): void {
  // No-op: no prune throttle state remains to reset.
}
