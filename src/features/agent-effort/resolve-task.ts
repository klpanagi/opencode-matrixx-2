import { log } from "../../shared/runtime/logger"
import { readSessionTasks } from "../task-session-scope/session-task-pending"

export interface ResolveEffortTaskIdInput {
  directory: string
  /** Explicit T-{uuid} supplied by the caller; wins when present. */
  explicitTaskId?: string
  /** Session that owns the task records (the delegating/parent session). */
  parentSessionID?: string
}

function isActive(status: string): boolean {
  return status === "in_progress" || status === "pending"
}

/**
 * Resolve which task record should receive a run's effort.
 * Explicit id wins. Otherwise, attach only when the parent session has exactly
 * ONE active (in_progress or pending) task — ambiguity is never guessed.
 * Never throws.
 */
export function resolveEffortTaskId(input: ResolveEffortTaskIdInput): string | undefined {
  try {
    if (typeof input.explicitTaskId === "string" && input.explicitTaskId.length > 0) {
      return input.explicitTaskId
    }
    if (!input.parentSessionID) return undefined

    const active = readSessionTasks({
      directory: input.directory,
      sessionID: input.parentSessionID,
    }).filter((task) => isActive(task.status))

    if (active.length !== 1) return undefined
    return active[0]?.id
  } catch (error) {
    log("[agent-effort] task resolution failed", {
      parentSessionID: input.parentSessionID,
      reason: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
