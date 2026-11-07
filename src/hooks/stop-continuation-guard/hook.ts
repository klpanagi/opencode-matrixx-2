import { log } from "../../shared/runtime/logger"
import { hasPendingQuestionMessage } from "../../shared/session/awaiting-user"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { fetchSessionMessages } from "../../shared/session/session-context-source"

const HOOK_NAME = "stop-continuation-guard"

export const STALE_STOP_MS = 30_000

function getMonotonicNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

interface StopContinuationGuardOptions {
  backgroundManager?: {
    cancelAllForSession: (sessionID: string) => number
  }
  // Parity with the countdown-start / inject-time awaiting-user guards:
  // consulted before cancelling background tasks so in-flight subagents
  // that asked a question are not killed while the user owes an answer.
  isAwaitingUser?: (sessionID: string) => boolean
  // Authoritative busy/idle signal (B13 idle/cooldown API wiring point).
  // When provided and returns false, the session is considered idle and a
  // fresh stop entry no longer blocks. Defaults to busy (conservative,
  // preserves pre-B14 blocking behaviour).
  isBusy?: (sessionID: string) => boolean
  nowMonotonic?: () => number
}

export interface StopBlockVerdict {
  blocked: boolean
  reason: string
  continuationHint?: string
}

import type { V2Event } from "../../plugin/tool/context"
export interface StopContinuationGuard {
  event: (event: V2Event) => Promise<void>
  "chat.message": (input: { sessionID?: string }) => Promise<void>
  stop: (sessionID: string) => Promise<void>
  isStopped: (sessionID: string) => boolean
  shouldBlock: (sessionID: string) => StopBlockVerdict
  clear: (sessionID: string) => void
}

export function createStopContinuationGuardHook(
  ctx: NativePluginContext,
  options?: StopContinuationGuardOptions
): StopContinuationGuard {
  const stoppedSessions = new Map<string, number>()
  const nowMonotonic = options?.nowMonotonic ?? getMonotonicNow

  const isSessionAwaitingUser = async (sessionID: string): Promise<boolean> => {
    if (options?.isAwaitingUser?.(sessionID)) return true
    try {
      return hasPendingQuestionMessage(await fetchSessionMessages(ctx, sessionID))
    } catch (error) {
      log(`[${HOOK_NAME}] Messages fetch failed, assuming not awaiting user`, { sessionID, error: String(error) })
      return false
    }
  }

  const stop = async (sessionID: string): Promise<void> => {
    stoppedSessions.set(sessionID, nowMonotonic())
    log(`[${HOOK_NAME}] Continuation stopped for session`, { sessionID })

    if (!options?.backgroundManager) return

    if (await isSessionAwaitingUser(sessionID)) {
      log(`[${HOOK_NAME}] Background cancellation suppressed: awaiting user`, { sessionID })
      return
    }

    const cancelled = options.backgroundManager.cancelAllForSession(sessionID)
    if (cancelled > 0) {
      log(`[${HOOK_NAME}] Cancelled ${cancelled} background task(s) for session`, { sessionID })
    }
  }

  const shouldBlock = (sessionID: string): StopBlockVerdict => {
    const stoppedAt = stoppedSessions.get(sessionID)
    if (stoppedAt === undefined) {
      return { blocked: false, reason: "not-stopped" }
    }
    if (nowMonotonic() - stoppedAt > STALE_STOP_MS) {
      stoppedSessions.delete(sessionID)
      log(`[${HOOK_NAME}] Stale stop entry expired, allowing continuation`, {
        sessionID,
        reason: "stale-enforcer-state",
      })
      return { blocked: false, reason: "stale-enforcer-state" }
    }
    const busy = options?.isBusy?.(sessionID) ?? true
    if (!busy) {
      stoppedSessions.delete(sessionID)
      log(`[${HOOK_NAME}] Session idle per authoritative check, allowing continuation`, {
        sessionID,
        reason: "idle-authoritative",
      })
      return { blocked: false, reason: "idle-authoritative" }
    }
    return {
      blocked: true,
      reason: "continuation-stopped: session busy",
      continuationHint:
        "Continuation is stopped for this session. Send a new message to clear the stop flag, or re-issue stop-continuation once in-flight tasks settle.",
    }
  }

  const isStopped = (sessionID: string): boolean => {
    return shouldBlock(sessionID).blocked
  }

  const clear = (sessionID: string): void => {
    stoppedSessions.delete(sessionID)
    log(`[${HOOK_NAME}] Continuation guard cleared for session`, { sessionID })
  }

  const eventHandler = async (event: V2Event): Promise<void> => {
    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        clear(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
    }
  }

  const chatMessage = async ({
    sessionID,
  }: {
    sessionID?: string
  }): Promise<void> => {
    if (sessionID && stoppedSessions.get(sessionID) !== undefined) {
      clear(sessionID)
      log(`[${HOOK_NAME}] Cleared stop state on new user message`, { sessionID })
    }
  }

  return {
    event: eventHandler,
    "chat.message": chatMessage,
    stop,
    isStopped,
    shouldBlock,
    clear,
  }
}
