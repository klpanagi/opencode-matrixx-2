import { log } from "../../../shared"
import { getTaskToastManager } from "../../task-toast-manager"
import { buildCompletionNotification } from "../notification-builder"
import type { BackgroundTask } from "../types"
import type { ManagerRuntime } from "./types"

export const NOTIFY_PARENT = true
export const NOTIFY_NONE = false
export const REMOVE_TOAST = true
export const KEEP_TOAST = false
export const RECORD_HISTORY = true
export const SKIP_HISTORY = false

export interface FinalizeOptions {
  status?: BackgroundTask["status"]
  source: string
  notify: boolean
  removeToast: boolean
  recordHistory: boolean
  incomingError?: string
  incomingOutput?: string
  effortLine?: string | null
  computeEffort?: () => Promise<string | null | undefined>
  logMessage?: string | null
}

export interface FinalizeResult {
  effortLine: string | null | undefined
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
    const payload = { sessionID: parentSessionID, text }
    const notify = rt.notify
    if (notify) {
      void Promise.resolve(notify(payload)).catch((error) => {
        log("[background-agent] parent notification failed:", error)
      })
      return
    }
    rt.native.session.prompt(payload).catch((error) => {
      log("[background-agent] parent notification failed:", error)
    })
  } catch (error) {
    log("[background-agent] parent notification failed:", error)
  }
}

export async function finalizeTask(
  rt: ManagerRuntime,
  task: BackgroundTask,
  options: FinalizeOptions,
): Promise<FinalizeResult> {
  if (options.status !== undefined) task.status = options.status
  if (task.completedAt === undefined) task.completedAt = new Date()
  if (options.incomingError !== undefined) task.error = options.incomingError
  if (options.incomingOutput !== undefined) task.resultSummary = options.incomingOutput.slice(0, 2000)

  rt.store.wallclock.disarm(task.id)
  rt.store.nativeDescCache.clear()
  rt.store.persistHandle(task)

  if (options.recordHistory) {
    rt.taskHistory.record(task.parentSessionID, {
      id: task.id,
      sessionID: task.sessionID,
      agent: task.agent,
      description: task.description,
      status: task.status,
      category: task.category,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    })
  }

  if (options.removeToast) {
    const toastManager = getTaskToastManager()
    if (toastManager) toastManager.removeTask(task.id)
  }

  if (options.logMessage !== null) {
    log(options.logMessage ?? `[background-agent] Task finalized (${options.source}):`, task.id)
  }

  let effortLine = options.effortLine
  if (effortLine === undefined && options.computeEffort !== undefined) {
    effortLine = await options.computeEffort()
  }

  if (options.notify) deliverParentNotification(rt, task, effortLine)

  return { effortLine }
}
