import { clearMissionState, getPlanProgress, readMissionState } from "../../features/mission-state"
import { subagentSessions } from "../../features/session-state/state"
import type { V2Event } from "../../plugin/tool/context"
import { getAgentConfigKey } from "../../shared/agent/agent-display-names"
import { isAbortError } from "../../shared/runtime/is-abort-error"
import { log } from "../../shared/runtime/logger"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { stateRootFromPluginContext } from "../../shared/session/state-root"
import { HOOK_NAME } from "./hook-name"
import { injectMissionContinuation } from "./mission-continuation-injector"
import { getLastAgentFromSession } from "./session-last-agent"
import type { NiobeHookOptions, SessionState } from "./types"

export const CONTINUATION_COOLDOWN_MS = 5000

const sessionContinuationLocks = new Map<string, Promise<void>>()

export function _resetSessionLocksForTesting(): void {
  sessionContinuationLocks.clear()
}

export function runWithSessionLock<T>(sessionID: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionContinuationLocks.get(sessionID) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  sessionContinuationLocks.set(sessionID, current)
  return previous.then(fn).finally(() => {
    if (sessionContinuationLocks.get(sessionID) === current) {
      sessionContinuationLocks.delete(sessionID)
    }
    release()
  })
}

export function getMonotonicNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

export interface ContinuationGates {
  hasMission: boolean
  missionComplete: boolean
  isContinuationStopped: boolean
  abortBeforeIdle: boolean
  bgRunning: boolean
  promptFailuresExceeded: boolean
}

export function isContinuationValid(gates: ContinuationGates): boolean {
  if (!gates.hasMission) return false
  if (gates.missionComplete) return false
  if (gates.isContinuationStopped) return false
  if (gates.abortBeforeIdle) return false
  if (gates.bgRunning) return false
  if (gates.promptFailuresExceeded) return false
  return true
}

export function tryClaimContinuationSlot(
  state: SessionState,
  now: number,
  cooldownMs: number = CONTINUATION_COOLDOWN_MS,
): boolean {
  const last = state.lastContinuationInjectedAt
  if (last !== undefined) {
    if (now - last < cooldownMs) return false
    if (now <= last) return false
  }
  state.lastContinuationInjectedAt = now
  return true
}

export function createNiobeEventHandler(input: {
  ctx: NativePluginContext
  options?: NiobeHookOptions
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
}): (event: V2Event) => Promise<void> {
  const { ctx, options, sessions, getState } = input
  const stateRoot = stateRootFromPluginContext(ctx)

  return async (event): Promise<void> => {
    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const state = getState(sessionID)
      const isAbort = isAbortError(props?.error)
      state.lastEventWasAbortError = isAbort

      log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      // Read mission state FIRST to check if this session is part of an active mission
      const missionState = readMissionState(stateRoot)
      const isMissionSession = missionState?.session_ids?.includes(sessionID) ?? false

      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      // Allow continuation only if: session is in mission's session_ids OR is a background task
      if (!isBackgroundTaskSession && !isMissionSession) {
        log(`[${HOOK_NAME}] Skipped: not mission or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.lastEventWasAbortError) {
        state.lastEventWasAbortError = false
        log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
        return
      }

      if (state.promptFailureCount >= 2) {
        log(`[${HOOK_NAME}] Skipped: continuation disabled after repeated prompt failures`, {
          sessionID,
          promptFailureCount: state.promptFailureCount,
        })
        return
      }

      const backgroundManager = options?.backgroundManager
      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some((t: { status: string }) => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      if (!missionState) {
        log(`[${HOOK_NAME}] No active mission`, { sessionID })
        return
      }

      if (options?.isContinuationStopped?.(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
        return
      }

      const lastAgent = await getLastAgentFromSession(sessionID, ctx)
      const lastAgentKey = getAgentConfigKey(lastAgent ?? "")
      const requiredAgent = getAgentConfigKey(missionState.agent ?? "niobe")
      const lastAgentMatchesRequired = lastAgentKey === requiredAgent
      const missionAgentWasNotExplicitlySet = missionState.agent === undefined
      const missionAgentDefaultsToNiobe = requiredAgent === "niobe"
      const lastAgentIsMorpheus = lastAgentKey === "morpheus"
      const allowMorpheusWhenDefaultNiobe = missionAgentWasNotExplicitlySet && missionAgentDefaultsToNiobe && lastAgentIsMorpheus
      const agentMatches = lastAgentMatchesRequired || allowMorpheusWhenDefaultNiobe
      if (!agentMatches) {
        log(`[${HOOK_NAME}] Skipped: last agent does not match mission agent`, {
          sessionID,
          lastAgent: lastAgent ?? "unknown",
          requiredAgent,
          missionAgentExplicitlySet: missionState.agent !== undefined,
        })
        return
      }

      const progress = getPlanProgress(missionState.active_plan)
      if (progress.isComplete) {
        log(`[${HOOK_NAME}] Mission complete`, { sessionID, plan: missionState.plan_name })
        clearMissionState(stateRoot)
        return
      }

      const nowFn = options?.nowMonotonic ?? getMonotonicNow
      const decision = await runWithSessionLock(sessionID, async () => {
        const now = nowFn()
        const claimed = tryClaimContinuationSlot(state, now)
        if (!claimed) {
          return { claimed: false as const, valid: false as const, now }
        }
        const freshMission = readMissionState(stateRoot)
        const freshProgress = freshMission ? getPlanProgress(freshMission.active_plan) : null
        const freshBgRunning = backgroundManager
          ? backgroundManager.getTasksByParentSession(sessionID).some((t: { status: string }) => t.status === "running")
          : false
        const valid = isContinuationValid({
          hasMission: freshMission !== null && freshMission !== undefined,
          missionComplete: freshProgress?.isComplete ?? true,
          isContinuationStopped: options?.isContinuationStopped?.(sessionID) ?? false,
          abortBeforeIdle: state.lastEventWasAbortError ?? false,
          bgRunning: freshBgRunning,
          promptFailuresExceeded: state.promptFailureCount >= 2,
        })
        return { claimed: true as const, valid, now }
      })
      if (!decision.claimed) {
        log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, {
          sessionID,
          cooldownRemaining: Math.max(
            0,
            CONTINUATION_COOLDOWN_MS - (nowFn() - (state.lastContinuationInjectedAt ?? 0)),
          ),
        })
        return
      }
      if (!decision.valid) {
        log(`[${HOOK_NAME}] Skipped: gates changed during await gap`, { sessionID })
        return
      }
      const remaining = progress.total - progress.completed
      try {
        await injectMissionContinuation({
          ctx,
          sessionID,
          planName: missionState.plan_name,
          remaining,
          total: progress.total,
          agent: missionState.agent,
          backgroundManager,
          sessionState: state,
        })
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to inject mission continuation`, { sessionID, error: err })
        state.promptFailureCount++
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (!sessionID) return

      const state = sessions.get(sessionID)
      if (state) {
        state.lastEventWasAbortError = false
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessions.delete(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessions.delete(sessionID)
        log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
      }
    }
  }
}
