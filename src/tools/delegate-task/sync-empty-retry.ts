import { DIAGNOSTIC_CAUSES, describeMessageShape } from "./diagnostic-shape"
import { formatDetailedError } from "./error-formatting"
import type { SessionMessage } from "./executor-types"
import type { DelegateTaskArgs, NativeClient } from "./types"

export const SYNC_EMPTY_RETRY_BACKOFF_MS = 1500

let backoffOverrideMs: number | undefined

export function getEmptyRetryBackoffMs(): number {
  return backoffOverrideMs ?? SYNC_EMPTY_RETRY_BACKOFF_MS
}

export function __setEmptyRetryBackoffMs(ms: number): void {
  backoffOverrideMs = ms
}

export function __resetEmptyRetryBackoffMs(): void {
  backoffOverrideMs = undefined
}

function isEmptyMessagePayload(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.length === 0
  const messages = (raw as { messages?: unknown } | null | undefined)?.messages
  return Array.isArray(messages) && messages.length === 0
}

export async function isSessionEmpty(client: NativeClient, sessionID: string): Promise<boolean> {
  let raw: unknown
  try {
    raw = await client.session.context({ sessionID })
  } catch {
    return false
  }
  return isEmptyMessagePayload(raw)
}

export function formatEmptySessionError(
  args: DelegateTaskArgs,
  sessionID: string,
  agentToUse: string,
  observed?: SessionMessage[],
): string {
  const observedShape = describeMessageShape(observed ?? [])
  return formatDetailedError(
    new Error(
      `Sync task produced no response: send+poll reported success but session ${sessionID} has zero messages after 1 retry. Observed: ${observedShape}. ${DIAGNOSTIC_CAUSES}`,
    ),
    {
      operation: "Send+poll sync task",
      args,
      sessionID,
      agent: agentToUse,
      category: args.category,
    },
  )
}
