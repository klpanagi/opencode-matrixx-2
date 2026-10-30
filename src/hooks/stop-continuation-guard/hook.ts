import { hasPendingQuestionMessage } from "../../shared/awaiting-user"
import { log } from "../../shared/logger"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"

const HOOK_NAME = "stop-continuation-guard"

interface StopContinuationGuardOptions {
  backgroundManager?: {
    cancelAllForSession: (sessionID: string) => number
  }
  // Parity with the countdown-start / inject-time awaiting-user guards:
  // consulted before cancelling background tasks so in-flight subagents
  // that asked a question are not killed while the user owes an answer.
  isAwaitingUser?: (sessionID: string) => boolean
}

import type { V2Event } from "../../plugin/context"
export interface StopContinuationGuard {
  event: (event: V2Event) => Promise<void>
  "chat.message": (input: { sessionID?: string }) => Promise<void>
  stop: (sessionID: string) => Promise<void>
  isStopped: (sessionID: string) => boolean
  clear: (sessionID: string) => void
}

export function createStopContinuationGuardHook(
  ctx: NativePluginContext,
  options?: StopContinuationGuardOptions
): StopContinuationGuard {
  const stoppedSessions = new Set<string>()

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
    stoppedSessions.add(sessionID)
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

  const isStopped = (sessionID: string): boolean => {
    return stoppedSessions.has(sessionID)
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
    if (sessionID && stoppedSessions.has(sessionID)) {
      clear(sessionID)
      log(`[${HOOK_NAME}] Cleared stop state on new user message`, { sessionID })
    }
  }

  return {
    event: eventHandler,
    "chat.message": chatMessage,
    stop,
    isStopped,
    clear,
  }
}
