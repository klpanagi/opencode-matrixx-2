import { notify } from "../../shared/notify"
import type { Client } from "./client"
import { fixEmptyMessages } from "./empty-content-recovery"
import { sanitizeEmptyMessagesBeforeSummarize } from "./message-builder"
import { clearSessionState, getEmptyContentAttempt, getOrCreateRetryState } from "./state"
import type { AutoCompactState } from "./types"
import { RETRY_CONFIG } from "./types"

export async function runSummarizeRetryStrategy(params: {
  sessionID: string
  msg: Record<string, unknown>
  autoCompactState: AutoCompactState
  client: Client
  directory: string
  errorType?: string
  messageIndex?: number
}): Promise<void> {
  const retryState = getOrCreateRetryState(params.autoCompactState, params.sessionID)

  if (params.errorType?.includes("non-empty content")) {
    const attempt = getEmptyContentAttempt(params.autoCompactState, params.sessionID)
    if (attempt < 3) {
      const fixed = await fixEmptyMessages({
        sessionID: params.sessionID,
        autoCompactState: params.autoCompactState,
        client: params.client,
        messageIndex: params.messageIndex,
      })
      if (fixed) {
        setTimeout(() => {
          void runSummarizeRetryStrategy(params)
        }, 500)
        return
      }
    } else {
      notify("error", "Recovery Failed: Max recovery attempts (3) reached for empty content error. Please start a new session.")
      return
    }
  }

  if (Date.now() - retryState.lastAttemptTime > 300000) {
    retryState.attempt = 0
    params.autoCompactState.truncateStateBySession.delete(params.sessionID)
  }

  if (retryState.attempt < RETRY_CONFIG.maxAttempts) {
    retryState.attempt++
    retryState.lastAttemptTime = Date.now()

    const providerID = params.msg.providerID as string | undefined
    const modelID = params.msg.modelID as string | undefined

    if (providerID && modelID) {
      try {
        await sanitizeEmptyMessagesBeforeSummarize(params.sessionID, params.client)

        notify("warn", `Auto Compact: Summarizing session (attempt ${retryState.attempt}/${RETRY_CONFIG.maxAttempts})...`)

        await params.client.session.compact({ sessionID: params.sessionID })
        return
      } catch {
        const delay =
          RETRY_CONFIG.initialDelayMs *
          RETRY_CONFIG.backoffFactor ** (retryState.attempt - 1)
        const cappedDelay = Math.min(delay, RETRY_CONFIG.maxDelayMs)

        setTimeout(() => {
          void runSummarizeRetryStrategy(params)
        }, cappedDelay)
        return
      }
    } else {
      notify("warn", "Summarize Skipped: Missing providerID or modelID.")
    }
  }

  clearSessionState(params.autoCompactState, params.sessionID)
  notify("error", "Auto Compact Failed: All recovery attempts failed. Please start a new session.")
}
