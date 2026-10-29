import type { V1EventEnvelope } from "./opencode-events"

export const DEDUPLICATE_WINDOW_MS = 500

export type EventPumpDeps = {
  subscribe(o: { signal: AbortSignal }): AsyncIterable<{ type: string } & Record<string, unknown>>
  handler(e: V1EventEnvelope): Promise<void>
  signal: AbortSignal
  guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>
  log?(message: string, data?: unknown): void
  toV1Event(e: unknown): V1EventEnvelope
  sleep?(ms: number, signal?: AbortSignal): Promise<void>
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

export function createEventPump(deps: EventPumpDeps): EventPump {
  let attempts = 0
  let delivered = 0
  let stopped = false
  let firstEventLogged = false

  return {
    start(): void {
      stopped = false
      attempts += 1
      const attempt = attempts
      deps.log?.("[matrixx] event pump subscribed", { attempt })
      void (async () => {
        try {
          for await (const event of deps.subscribe({ signal: deps.signal })) {
            if (stopped || deps.signal.aborted) return
            await deps.guard(`event:${event.type}`, () => deps.handler(deps.toV1Event(event)))
            if (stopped || deps.signal.aborted) return
            delivered += 1
            if (!firstEventLogged) {
              firstEventLogged = true
              deps.log?.("[matrixx] event pump first event", { type: event.type, attempt })
            }
          }
        } catch (error) {
          if (!deps.signal.aborted) {
            deps.log?.("[matrixx] event stream ended", {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })()
    },
    stop(): void {
      stopped = true
    },
    stats(): EventPumpStats {
      return { attempts, delivered, consecutiveFailures: 0, dead: false }
    },
  }
}
