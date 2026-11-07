/**
 * Revive eligibility classification for background tasks.
 *
 * Pure logic: decides whether a persisted handle may be revived into a new
 * session. No I/O, no manager access, no client imports.
 */

import type { BgHandle } from "./handle-index"
import { readHandle } from "./handle-index"
import type { BackgroundTask } from "./types"

export const REVIVABLE_STATUSES = ["cancelled", "stopped", "interrupt", "error", "completed"] as const

export function isRevivableStatus(status: string): boolean {
  return (REVIVABLE_STATUSES as readonly string[]).includes(status)
}

export type ReviveBlockReason = "active" | "uncertain" | "no-session" | "unknown-task" | "expired"

export type ReviveEligibility = { eligible: true } | { eligible: false; reason: ReviveBlockReason }

// "expired" is never returned by this function — it is synthesized by the tool layer from an on-disk handle miss.
export function classifyRevivable(
  handle: { status: string; sessionID?: string; terminalReason?: string },
  opts?: { force?: boolean },
): ReviveEligibility {
  if (handle.status === "pending" || handle.status === "running") {
    return { eligible: false, reason: "active" }
  }
  if (handle.sessionID === undefined || handle.sessionID.trim().length === 0) {
    return { eligible: false, reason: "no-session" }
  }
  if (handle.status === "statusUncertain") {
    if (opts?.force === true) {
      return { eligible: true }
    }
    return { eligible: false, reason: "uncertain" }
  }
  if (isRevivableStatus(handle.status)) {
    return { eligible: true }
  }
  return { eligible: false, reason: "unknown-task" }
}

/**
 * B11: corrupt-handle predicate (pure, no I/O).
 *
 * Links the B7 error contract (`StorageCorruptError` in task-storage):
 * callers quarantine (rename aside + log, never delete) any value for
 * which this returns true instead of letting it crash revival. A handle
 * is corrupt when it is not an object or lacks the required shape
 * (`taskId` string + recognised `status` string). Unknown statuses are
 * NOT corrupt — they are ineligible (`unknown-task`) via
 * `classifyRevivable`, not quarantine candidates.
 */
export function isCorruptHandleValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true
  const record = value as Record<string, unknown>
  if (typeof record.taskId !== "string" || record.taskId.length === 0) return true
  if (typeof record.status !== "string") return true
  return false
}

export type ReviveSkip = { handle: BgHandle; reason: ReviveBlockReason }

/**
 * B11: partition handles into revivable vs skipped (pure, no I/O).
 *
 * Terminal handles WITHOUT a session (`completed`/`error`/`cancelled`
 * with no `sessionID`) are never resurrected — they land in `skipped`
 * with reason `no-session`. Active handles (`pending`/`running`) land
 * in `skipped` with reason `active` (inspect via `background_output`,
 * not revive). Callers MUST log each skip (reason + taskId).
 */
export function filterRevivableHandles(
  handles: BgHandle[],
  opts?: { force?: boolean },
): { eligible: BgHandle[]; skipped: ReviveSkip[] } {
  const eligible: BgHandle[] = []
  const skipped: ReviveSkip[] = []
  for (const handle of handles) {
    const result = classifyRevivable(handle, opts)
    if (result.eligible) {
      eligible.push(handle)
    } else {
      skipped.push({ handle, reason: result.reason })
    }
  }
  return { eligible, skipped }
}

/**
 * Locate a revivable handle by task id or session id. `taskId` wins when
 * both are supplied. Returns `undefined` when neither matches.
 */
export function findRevivableHandle(
  handles: BgHandle[],
  opts: { taskId?: string; sessionId?: string },
): BgHandle | undefined {
  if (opts.taskId !== undefined && opts.taskId !== "") {
    const byTask = handles.find((handle) => handle.taskId === opts.taskId)
    if (byTask) return byTask
  }
  if (opts.sessionId !== undefined && opts.sessionId !== "") {
    return handles.find((handle) => handle.sessionID === opts.sessionId)
  }
  return undefined
}

/**
 * Rehydrate a pre-admission `BackgroundTask` from a persisted handle with a
 * NEW prompt. Mirrors `restoreTaskFromHandle` except `prompt` comes from the
 * caller and `status` restarts at `"pending"`; `startedAt` is left unset (it
 * is assigned on admission) and `completedAt`/`error` are cleared.
 */
export type DeadTargetReason = "expired" | "stale-generation" | "session-dead"

export class DeadReviveTargetError extends Error {
  kind = "DeadTarget" as const
  reason: DeadTargetReason
  taskId: string
  constructor(taskId: string, reason: DeadTargetReason, detail: string) {
    super(`[revive] DeadTarget: task=${taskId} reason=${reason} ${detail}`)
    this.name = "DeadReviveTargetError"
    this.reason = reason
    this.taskId = taskId
  }
}

export type ProbeCandidate = { taskId: string; sessionID?: string; generation?: number }

export type ProbeResult = { alive: true } | { alive: false; reason: DeadTargetReason; error: DeadReviveTargetError }

export function probeReviveTarget(
  directory: string,
  candidate: ProbeCandidate,
  opts?: { expectedGeneration?: number; isSessionLive?: (sessionID: string) => boolean },
): ProbeResult {
  if (candidate.sessionID === undefined || candidate.sessionID.trim().length === 0) {
    return {
      alive: false,
      reason: "session-dead",
      error: new DeadReviveTargetError(candidate.taskId, "session-dead", "no session to probe"),
    }
  }
  const onDisk = readHandle(directory, candidate.taskId)
  if (onDisk === null) {
    return {
      alive: false,
      reason: "expired",
      error: new DeadReviveTargetError(candidate.taskId, "expired", "handle missing or swept from disk"),
    }
  }
  const expected = opts?.expectedGeneration ?? candidate.generation
  if (expected !== undefined && onDisk.generation !== expected) {
    return {
      alive: false,
      reason: "stale-generation",
      error: new DeadReviveTargetError(
        candidate.taskId,
        "stale-generation",
        `expected gen ${expected}, found gen ${onDisk.generation}`,
      ),
    }
  }
  const live = opts?.isSessionLive?.(candidate.sessionID) ?? true
  if (!live) {
    return {
      alive: false,
      reason: "session-dead",
      error: new DeadReviveTargetError(candidate.taskId, "session-dead", `session ${candidate.sessionID} no longer live`),
    }
  }
  return { alive: true }
}

export function toReviveTask(handle: BgHandle, prompt: string): BackgroundTask {
  return {
    id: handle.taskId,
    parentSessionID: handle.parentSessionID,
    parentMessageID: handle.parentMessageID,
    description: handle.description,
    prompt,
    agent: handle.agent,
    status: "pending",
    sessionID: handle.sessionID,
    queuedAt: handle.queuedAt !== undefined ? new Date(handle.queuedAt) : undefined,
    completedAt: undefined,
    error: undefined,
    model: handle.model,
    category: handle.category,
    concurrencyGroup: handle.concurrencyGroup,
  }
}
