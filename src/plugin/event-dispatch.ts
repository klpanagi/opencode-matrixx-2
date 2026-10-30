import { log as defaultLog } from "../shared/logger"
import type { V2Event } from "./context"

export const DISPATCH_BACKOFF_BASE_MS = 250
export const DISPATCH_BACKOFF_MAX_MS = 30_000
export const DEDUPLICATE_WINDOW_MS = 500

export function dispatchBackoffMs(consecutiveFailures: number): number {
  return Math.min(DISPATCH_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), DISPATCH_BACKOFF_MAX_MS)
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, Math.max(0, ms))
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    function onAbort(): void {
      done()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export type EventSubscriber = (options: { signal: AbortSignal }) => AsyncIterable<V2Event>

export type DispatchGuard = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>

export type EventDispatcherDeps = {
  handler: (event: V2Event) => Promise<void>
  guard: DispatchGuard
  log?: (message: string, data?: unknown) => void
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

export type EventDispatcherStats = {
  attempts: number
  delivered: number
  consecutiveFailures: number
}

export type EventDispatcher = {
  dispatchMatrixxEvent: (event: V2Event) => Promise<void>
  start: (subscribe: EventSubscriber, signal: AbortSignal) => void
  stop: () => void
  stats: () => EventDispatcherStats
}

export function createEventDispatcher(deps: EventDispatcherDeps): EventDispatcher {
  let attempts = 0
  let delivered = 0
  let consecutiveFailures = 0
  let stopped = false
  const sleep = deps.sleep ?? defaultSleep
  const log = deps.log ?? defaultLog

  async function dispatchMatrixxEvent(event: V2Event): Promise<void> {
    try {
      await deps.guard(`event:${event.type}`, () => deps.handler(event))
      delivered += 1
    } catch (error) {
      log("[matrixx] event dispatch error", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    dispatchMatrixxEvent,
    start(subscribe, signal): void {
      stopped = false
      void (async () => {
        try {
          let attempt = 0
          for (;;) {
            if (attempt > 0 && (stopped || signal.aborted)) return
            attempt += 1
            attempts = attempt
            log("[matrixx] event dispatch subscribed", { attempt })
            try {
              for await (const event of subscribe({ signal })) {
                if (stopped || signal.aborted) return
                await dispatchMatrixxEvent(event)
              }
              consecutiveFailures = 0
            } catch (error) {
              if (stopped || signal.aborted) return
              const message = error instanceof Error ? error.message : String(error)
              log("[matrixx] event dispatch resubscribe", { error: message })
              consecutiveFailures += 1
            }
            if (stopped || signal.aborted) return
            await sleep(dispatchBackoffMs(Math.max(1, consecutiveFailures)), signal)
          }
        } catch (error) {
          log("[matrixx] event dispatch stopped", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    },
    stop(): void {
      stopped = true
    },
    stats(): EventDispatcherStats {
      return { attempts, delivered, consecutiveFailures }
    },
  }
}
