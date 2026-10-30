import type { MatrixxConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"
import { notify } from "../../shared/notify"
import type { NativePluginContext } from "../../shared/session-context-source"

import {
  COUNTDOWN_SECONDS,
  HOOK_NAME,
} from "./constants"
import { injectContinuation } from "./continuation-injection"
import type { SessionStateStore } from "./session-state"
import type { ResolvedMessageInfo } from "./types"

function showCountdownToast(seconds: number, incompleteCount: number): void {
  notify("warn", `Task Continuation: Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`)
}

export function startCountdown(args: {
  ctx: NativePluginContext
  sessionID: string
  incompleteCount: number
  total: number
  resolvedInfo?: ResolvedMessageInfo
  backgroundManager?: BackgroundManager
  skipAgents: string[]
  sessionStateStore: SessionStateStore
  config?: Partial<MatrixxConfig>
}): void {
  const {
    ctx,
    sessionID,
    incompleteCount,
    resolvedInfo,
    backgroundManager,
    skipAgents,
    sessionStateStore,
    config,
  } = args

  const state = sessionStateStore.getState(sessionID)
  if (state.countdownTimer || state.countdownInterval) {
    log(`[${HOOK_NAME}] Skipped: countdown already active`, { sessionID })
    return
  }

  let secondsRemaining = COUNTDOWN_SECONDS
  showCountdownToast(secondsRemaining, incompleteCount)
  state.countdownStartedAt = Date.now()

  state.countdownInterval = setInterval(() => {
    secondsRemaining--
    if (secondsRemaining > 0) {
      showCountdownToast(secondsRemaining, incompleteCount)
    }
  }, 1000)

  state.countdownTimer = setTimeout(() => {
    sessionStateStore.cancelCountdown(sessionID)
    injectContinuation({
      ctx,
      sessionID,
      backgroundManager,
      skipAgents,
      resolvedInfo,
      sessionStateStore,
      config,
    })
  }, COUNTDOWN_SECONDS * 1000)

  log(`[${HOOK_NAME}] Countdown started`, {
    sessionID,
    seconds: COUNTDOWN_SECONDS,
    incompleteCount,
  })
}
