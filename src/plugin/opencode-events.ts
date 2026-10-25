/**
 * V2 event → V1 event translation.
 *
 * V1 hooks receive `{ event: { type, properties } }`; V2 delivers encoded
 * `OpenCodeEvent`s over `ctx.event.subscribe()`. The event `type` strings are
 * shared, but V2 nests (or flattens) the payload differently, so the payload is
 * exposed as `properties` in both layouts.
 */

import type { V2Event } from "./opencode-types"

export interface V1EventEnvelope {
  event: { type: string; properties: Record<string, unknown> }
}

export function toV1Event(event: V2Event): V1EventEnvelope {
  const record = event as unknown as Record<string, unknown>
  const payload = record.data ?? record.properties
  const properties =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : record
  return { event: { type: event.type, properties } }
}
