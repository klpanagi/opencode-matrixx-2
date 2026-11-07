import { log as sharedLog } from "../../shared/runtime/logger"

export const DEFAULT_STOP_DEADLINE_MS = 5000
export const DEFAULT_STOP_POLL_INTERVAL_MS = 100

export class DeadlineExceededError extends Error {
  readonly code = "DeadlineExceeded" as const
  readonly taskIds: string[]
  readonly deadlineMs: number
  constructor(taskIds: string[], deadlineMs: number) {
    super(
      `Stop deadline exceeded after ${deadlineMs}ms; abandoned ${taskIds.length} task(s): ${taskIds.join(", ")}`,
    )
    this.name = "DeadlineExceededError"
    this.taskIds = taskIds
    this.deadlineMs = deadlineMs
  }
}

export function isDeadlineExceeded(error: unknown): error is DeadlineExceededError {
  return (
    error instanceof DeadlineExceededError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "DeadlineExceeded")
  )
}

export interface StopDeadlineDeps {
  cancel: () => string[]
  pendingIds: () => string[]
  disarm: (taskId: string) => void
  disarmAll?: () => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string, data?: unknown) => void
}

export interface StopDeadlineOptions {
  deadlineMs?: number
  pollIntervalMs?: number
}

export interface StopDeadlineResult {
  forced: boolean
  abandoned: string[]
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function stopWithDeadline(
  sessionID: string,
  deps: StopDeadlineDeps,
  options?: StopDeadlineOptions,
): Promise<StopDeadlineResult> {
  const deadlineMs = options?.deadlineMs ?? DEFAULT_STOP_DEADLINE_MS
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_STOP_POLL_INTERVAL_MS
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const emit = deps.log ?? sharedLog

  deps.cancel()
  const start = now()
  let pending = deps.pendingIds()
  while (pending.length > 0 && now() - start < deadlineMs) {
    await sleep(pollIntervalMs)
    pending = deps.pendingIds()
  }
  if (pending.length === 0) {
    return { forced: false, abandoned: [] }
  }
  for (const taskId of pending) {
    try {
      deps.disarm(taskId)
    } catch (error) {
      emit("[stop-continuation-guard] Stop force disarm failed", { sessionID, taskId, error: String(error) })
    }
  }
  try {
    deps.disarmAll?.()
  } catch (error) {
    emit("[stop-continuation-guard] Stop force disarm-all failed", { sessionID, error: String(error) })
  }
  const error = new DeadlineExceededError(pending, deadlineMs)
  emit("[stop-continuation-guard] Deadline exceeded, forcing stop", {
    sessionID,
    abandoned: pending,
    deadlineMs,
    code: error.code,
  })
  throw error
}
