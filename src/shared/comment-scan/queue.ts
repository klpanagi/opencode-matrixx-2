import {
  DEFAULT_QUEUE_CONCURRENCY,
  DEFAULT_QUEUE_MAX_PENDING,
  DEFAULT_SG_TIMEOUT_MS,
} from "./constants"
import type { BoundedQueue, BoundedQueueOptions } from "./types"

/**
 * Bounded FIFO admission queue for comment-scan work.
 *
 * At most `concurrency` tasks run at once and the rest wait in FIFO order. Work is never
 * dropped — callers are held by admission backpressure until a slot frees up.
 * A task that outlives its timeout rejects with QueueTimeoutError and frees its slot.
 */

export class QueueTimeoutError extends Error {
  readonly elapsedMs: number

  constructor(timeoutMs: number, elapsedMs: number) {
    super(`comment-scan task exceeded its ${timeoutMs}ms budget`)
    this.name = "QueueTimeoutError"
    this.elapsedMs = elapsedMs
  }
}

interface QueueEntry {
  readonly activate: () => void
}

// Resolved per call, never captured at module load, so an injected scheduler always wins.
function defaultSchedule(fire: () => void, ms: number): unknown {
  const handle = globalThis.setTimeout(fire, ms)
  return () => {
    globalThis.clearTimeout(handle)
  }
}

export function createBoundedQueue(options: BoundedQueueOptions = {}): BoundedQueue {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_QUEUE_CONCURRENCY)
  const maxPending = Math.max(0, options.maxPending ?? DEFAULT_QUEUE_MAX_PENDING)
  const timeoutMs = options.taskTimeoutMs ?? DEFAULT_SG_TIMEOUT_MS
  const schedule = options.schedule ?? defaultSchedule
  const now = options.now ?? Date.now
  const onOverflow = options.onOverflow

  const waiting: QueueEntry[] = []
  let active = 0
  let overflowNotified = false

  function pump(): void {
    while (active < concurrency && waiting.length > 0) {
      const entry = waiting.shift()
      if (!entry) break
      entry.activate()
    }
    if (waiting.length <= maxPending) {
      overflowNotified = false
    }
  }

  function start<T>(
    task: () => Promise<T>,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
  ): void {
    active += 1
    const startedAt = now()
    let settled = false

    function release(): void {
      active -= 1
      pump()
    }

    const cancelTimer = schedule(() => {
      if (settled) return
      settled = true
      reject(new QueueTimeoutError(timeoutMs, Math.max(0, now() - startedAt)))
      release()
    }, timeoutMs)

    function cancel(): void {
      if (typeof cancelTimer === "function") {
        cancelTimer()
      }
    }

    void Promise.resolve()
      .then(task)
      .then(
        (value) => {
          if (settled) return
          settled = true
          cancel()
          resolve(value)
          release()
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          cancel()
          reject(error)
          release()
        },
      )
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({ activate: () => start(task, resolve, reject) })
        if (waiting.length > maxPending && !overflowNotified) {
          overflowNotified = true
          onOverflow?.()
        }
        pump()
      })
    },
    get active(): number {
      return active
    },
    get pending(): number {
      return waiting.length
    },
  }
}

