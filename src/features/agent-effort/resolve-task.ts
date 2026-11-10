import { log } from "../../shared/runtime/logger"
import { DEFAULT_ANCESTRY_DEPTH, walkSessionAncestry } from "../task-session-scope/ancestry"
import { readSessionTasks } from "../task-session-scope/session-task-pending"

export interface ResolveEffortTaskIdInput {
  directory: string
  /** Explicit T-{uuid} supplied by the caller; wins when present. */
  explicitTaskId?: string
  /** Child session that ran the work; walked upward when parentSessionID is absent. */
  sessionID?: string
  /** Session that owns the task records (the delegating/parent session). */
  parentSessionID?: string
  /**
   * Resolve a session's parent link. Defaults to a no-op (no walk past the
   * given parent); callers wire the in-memory subagent registry here.
   */
  getParentSessionID?: (sessionID: string) => string | undefined
  /** Max session-ancestry hops. Defaults to {@link DEFAULT_ANCESTRY_DEPTH}. */
  depth?: number
}

function isActive(status: string): boolean {
  return status === "in_progress" || status === "pending"
}

/**
 * Resolve which task record should receive a run's effort.
 * Explicit id wins. Otherwise, walk the session ancestry - starting at the
 * parent session, or at the child session's parent when only the child is
 * known - and attach to the first level that owns exactly ONE active
 * (in_progress or pending) task. Ambiguity is never guessed: a level with two
 * or more active tasks resolves to no attribution, without looking further up.
 * Depth-bounded (default 3), cycle-safe, and never throws.
 */
export function resolveEffortTaskId(input: ResolveEffortTaskIdInput): string | undefined {
  try {
    if (typeof input.explicitTaskId === "string" && input.explicitTaskId.length > 0) {
      return input.explicitTaskId
    }
    const start =
      input.parentSessionID ??
      (input.sessionID !== undefined ? input.getParentSessionID?.(input.sessionID) : undefined)
    if (!start) return undefined

    const chain = walkSessionAncestry(
      start,
      input.getParentSessionID ?? (() => undefined),
      input.depth ?? DEFAULT_ANCESTRY_DEPTH,
    )
    for (const sessionID of chain) {
      const active = readSessionTasks({
        directory: input.directory,
        sessionID,
      }).filter((task) => isActive(task.status))

      if (active.length === 1) return active[0]?.id
      if (active.length > 1) return undefined
    }
    return undefined
  } catch (error) {
    log("[agent-effort] task resolution failed", {
      parentSessionID: input.parentSessionID,
      reason: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
