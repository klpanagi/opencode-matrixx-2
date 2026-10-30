import { normalizeSDKResponse } from "../../shared"
import { DIAGNOSTIC_CAUSES, describeMessageShape } from "./diagnostic-shape"
import { formatDetailedError } from "./error-formatting"
import type { SessionMessage } from "./executor-types"
import type { DelegateTaskArgs, OpencodeClient } from "./types"

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

export async function isSessionEmpty(client: OpencodeClient, sessionID: string): Promise<boolean> {
  let messagesResult: unknown
  try {
    messagesResult = await client.session.messages({ path: { id: sessionID } })
  } catch {
    return false
  }
  if (!messagesResult) return false
  const messages = normalizeSDKResponse(messagesResult, [] as SessionMessage[], {
    preferResponseOnMissingData: true,
  })
  if (!Array.isArray(messages)) return false
  return messages.length === 0
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
