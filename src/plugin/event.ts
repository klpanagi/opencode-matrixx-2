import type { MatrixxConfig } from "../config"
import { invalidateSdkMessageCache } from "../features/hook-message-injector"
import {
  clearSessionAgent,
  getMainSessionID,
  isMainSessionCandidate,
  setMainSession,
  updateSessionAgent,
} from "../features/session-state/state"
import { resetMessageCursor } from "../shared"
import { log } from "../shared/logger"
import type { NativePluginContext } from "../shared/session-context-source"
import { lspManager } from "../tools"
import type { MatrixxContext, V2Event } from "./context"
import { DEDUPLICATE_WINDOW_MS } from "./event-dispatch"
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"
import type { DomainHooks, DomainManagers } from "./setup-domains"

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
  clear: (sessionID: string) => void
}

export function createEventHandler(args: {
  ctx: MatrixxContext & NativePluginContext
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  managers: DomainManagers
  hooks: DomainHooks
}): (event: V2Event) => Promise<void> {
  const { ctx, firstMessageVariantGate, hooks } = args

  const dispatchToHooks = async (event: V2Event): Promise<void> => {
    await Promise.resolve(hooks.autoUpdateChecker?.event?.(event))
    await Promise.resolve(hooks.backgroundNotificationHook?.event?.(event))
    await Promise.resolve(hooks.sessionNotification?.(event))
    await Promise.resolve(hooks.taskContinuationEnforcer?.handler?.(event))
    await Promise.resolve(hooks.unstableAgentBabysitter?.event?.(event))
    await Promise.resolve(hooks.nudgeLoopBreaker?.event?.(event))
    await Promise.resolve(hooks.contextWindowMonitor?.event?.(event))
    await Promise.resolve(hooks.directoryAgentsInjector?.event?.(event))
    await Promise.resolve(hooks.rulesInjector?.event?.(event))
    await Promise.resolve(hooks.knowledgeHubInjector?.event?.(event))
    await Promise.resolve(hooks.thinkMode?.event?.(event))
    await Promise.resolve(hooks.contextWindowLimitRecovery?.event?.(event))
    await Promise.resolve(hooks.agentUsageReminder?.event?.(event))
    await Promise.resolve(hooks.categorySkillReminder?.event?.(event))
    await Promise.resolve(hooks.interactiveBashSession?.event?.(event))
    await Promise.resolve(hooks.matrixLoop?.event?.(event))
    await Promise.resolve(hooks.stopContinuationGuard?.event?.(event))
    await Promise.resolve(hooks.niobeHook?.handler?.(event))
    await Promise.resolve(hooks.planPersister?.event?.(event))
    await Promise.resolve(hooks.runtimeFallback?.event?.(event))
    await Promise.resolve(hooks.sessionMemory?.event?.(event))
  }


  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()

  return async (event: V2Event): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUPLICATE_WINDOW_MS,
    })

    if (event.type === "session.idle") {
      const sessionID = (event.data as Record<string, unknown> | undefined)?.sessionID as string | undefined
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID)
        if (emittedAt && Date.now() - emittedAt < DEDUPLICATE_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID)
          return
        }
        recentRealIdles.set(sessionID, Date.now())
      }
    }

    await dispatchToHooks(event)

    const syntheticIdle = normalizeSessionStatusToIdle(event)
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.data as Record<string, unknown>)?.sessionID as string
      const emittedAt = recentRealIdles.get(sessionID)
      if (emittedAt && Date.now() - emittedAt < DEDUPLICATE_WINDOW_MS) {
        recentRealIdles.delete(sessionID)
        return
      }
      recentSyntheticIdles.set(sessionID, Date.now())
      await dispatchToHooks(syntheticIdle)
    }

    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string; metadata?: Record<string, unknown> }
        | undefined

      if (isMainSessionCandidate(sessionInfo)) {
        setMainSession(sessionInfo?.id)
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo)
      // D5: native session APIs own subagent display; no tmux mirror.
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined)
      }

      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id)
        resetMessageCursor(sessionInfo.id)
        invalidateSdkMessageCache(sessionInfo.id)
        firstMessageVariantGate.clear(sessionInfo.id)
        await lspManager.cleanupTempDirectoryClients()
        // D5: native session APIs own subagent display; no tmux mirror.
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined
      const role = info?.role as string | undefined
      if (sessionID && agent && role === "user") {
        updateSessionAgent(sessionID, agent)
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error

      if (hooks.sessionRecovery?.isRecoverableError(error)) {
        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        }
        const recovered = await hooks.sessionRecovery.handleSessionRecovery(messageInfo)

        if (
          recovered &&
          sessionID &&
          sessionID === getMainSessionID() &&
          !hooks.stopContinuationGuard?.isStopped(sessionID)
        ) {
          await ctx.session
            .prompt({
              sessionID,
              parts: [{ type: "text", text: "continue" }],
            })
            .catch((err) => { log("[plugin] Session prompt failed:", err) })
        }
      }
    }
  }
}
