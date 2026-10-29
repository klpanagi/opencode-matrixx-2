import type { V1EventEnvelope } from "./opencode-events"

export const DEDUPLICATE_WINDOW_MS = 500
export const PUMP_BACKOFF_BASE_MS = 250
export const PUMP_BACKOFF_MAX_MS = 30_000
export const MAX_CONSECUTIVE_PUMP_FAILURES = 5

export type EventPumpDeps = {
  subscribe(o: { signal: AbortSignal }): AsyncIterable<{ type: string } & Record<string, unknown>>
  handler(e: V1EventEnvelope): Promise<void>
  signal: AbortSignal
  guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>
  log?(message: string, data?: unknown): void
  toV1Event(e: unknown): V1EventEnvelope
  sleep?(ms: number, signal?: AbortSignal): Promise<void>
  now?: () => number
}

export type EventPumpStats = {
  attempts: number
  delivered: number
  consecutiveFailures: number
  dead: boolean
}

export type EventPump = {
  start(): void
  stop(): void
  stats(): EventPumpStats
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      parts.push(`${JSON.stringify(key)}:${stableStringify(record[key])}`)
    }
    return `{${parts.join(",")}}`
  }
  return JSON.stringify(value) as string
}

export function pumpBackoffMs(consecutiveFailures: number): number {
  return Math.min(PUMP_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), PUMP_BACKOFF_MAX_MS)
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

export function createEventPump(deps: EventPumpDeps): EventPump {
  let attempts = 0
  let delivered = 0
  let consecutiveFailures = 0
  let dead = false
  let stopped = false
  let firstEventLogged = false
  let lastDelivered: { fingerprint: string; at: number } | undefined
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now

  return {
    start(): void {
      stopped = false
      void (async () => {
        let attempt = 0
        for (;;) {
          if (attempt > 0 && (stopped || deps.signal.aborted || dead)) return
          attempt += 1
          attempts = attempt
          deps.log?.("[matrixx] event pump subscribed", { attempt })
          try {
            for await (const event of deps.subscribe({ signal: deps.signal })) {
              if (stopped || deps.signal.aborted) return
              const converted = deps.toV1Event(event)
              if (event.type === "session.idle") {
                const fingerprint = `session.idle:${stableStringify(converted.event.properties)}`
                const at = now()
                if (lastDelivered && lastDelivered.fingerprint === fingerprint && at - lastDelivered.at < DEDUPLICATE_WINDOW_MS) {
                  continue
                }
                await deps.guard(`event:${event.type}`, () => deps.handler(converted))
                if (stopped || deps.signal.aborted) return
                delivered += 1
                consecutiveFailures = 0
                lastDelivered = { fingerprint, at }
              } else {
                await deps.guard(`event:${event.type}`, () => deps.handler(converted))
                if (stopped || deps.signal.aborted) return
                delivered += 1
                consecutiveFailures = 0
              }
              if (!firstEventLogged) {
                firstEventLogged = true
                deps.log?.("[matrixx] event pump first event", { type: event.type, attempt })
              }
            }
            return
          } catch (error) {
            if (stopped || deps.signal.aborted) return
            const message = error instanceof Error ? error.message : String(error)
            deps.log?.("[matrixx] event stream ended", { error: message })
            consecutiveFailures += 1
            if (consecutiveFailures >= MAX_CONSECUTIVE_PUMP_FAILURES) {
              dead = true
              deps.log?.("[matrixx] event pump dead", { attempts, lastError: message })
              return
            }
            const backoffMs = pumpBackoffMs(consecutiveFailures)
            await sleep(backoffMs, deps.signal)
            if (stopped || deps.signal.aborted) return
            deps.log?.("[matrixx] event pump resubscribe", { attempt: attempt + 1, backoffMs, error: message })
          }
        }
      })()
    },
    stop(): void {
      stopped = true
    },
    stats(): EventPumpStats {
      return { attempts, delivered, consecutiveFailures, dead }
    },
  }
}
