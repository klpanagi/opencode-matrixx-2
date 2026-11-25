import { log as defaultLog } from "../../shared/runtime/logger"
import type { V2Event } from "./context"

export const DISPATCH_BACKOFF_BASE_MS = 250
export const DISPATCH_BACKOFF_MAX_MS = 30_000
export const DEDUPLICATE_WINDOW_MS = 500
export const DISPATCH_MAX_IN_FLIGHT_SESSIONS = 8

const GLOBAL_SESSION_KEY = "__global__"

function readString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Session lane for an event: its session id when it carries one, otherwise one
 * shared global lane so unrelated session-less events still stay ordered. */
export function eventSessionKey(event: V2Event): string {
  const data = event.data as Record<string, unknown> | undefined
  const info = data?.info as Record<string, unknown> | undefined
  const infoID = event.type.startsWith("session.") ? readString(info, "id") : undefined
  return (
    readString(data, "sessionID") ??
    readString(info, "sessionID") ??
    infoID ??
    readString(event, "sessionID") ??
    readString(event.properties as Record<string, unknown> | undefined, "sessionID") ??
    GLOBAL_SESSION_KEY
  )
}

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
  maxInFlightSessions?: number
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
  const maxInFlightSessions = deps.maxInFlightSessions ?? DISPATCH_MAX_IN_FLIGHT_SESSIONS
  const sessionChains = new Map<string, Promise<void>>()
  const slotWaiters: Array<() => void> = []
  let inFlightSessions = 0
  let capWaitCount = 0

  function acquireSlot(sessionKey: string): Promise<void> {
    if (maxInFlightSessions <= 0 || inFlightSessions < maxInFlightSessions) {
      inFlightSessions += 1
      return Promise.resolve()
    }
    capWaitCount += 1
    log("[matrixx] event dispatch concurrency cap reached", {
      inFlightSessions,
      maxInFlightSessions,
      capWaits: capWaitCount,
      session: sessionKey,
    })
    return new Promise<void>((resolve) => {
      slotWaiters.push(resolve)
    })
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift()
    if (next) {
      next()
      return
    }
    inFlightSessions -= 1
  }

  async function runSessionEvent(sessionKey: string, event: V2Event): Promise<void> {
    if (stopped) return
    await acquireSlot(sessionKey)
    try {
      await dispatchMatrixxEvent(event)
    } finally {
      releaseSlot()
    }
  }

  function enqueueEvent(event: V2Event): Promise<void> {
    const sessionKey = eventSessionKey(event)
    const previous = sessionChains.get(sessionKey) ?? Promise.resolve()
    const current = previous.then(() => runSessionEvent(sessionKey, event))
    sessionChains.set(sessionKey, current)
    void current
      .finally(() => {
        if (sessionChains.get(sessionKey) === current) sessionChains.delete(sessionKey)
      })
      .catch((error) => {
        log("[matrixx] event dispatch pump cleanup error", {
          session: sessionKey,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return current
  }

  async function dispatchMatrixxEvent(event: V2Event): Promise<void> {
    try {
      await deps.guard(`event:${event.type}`, () => deps.handler(event))
      delivered += 1
    } catch (error) {
      log("[matrixx] event dispatch error", {
        type: event.type,
        session: eventSessionKey(event),
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
                enqueueEvent(event)
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
