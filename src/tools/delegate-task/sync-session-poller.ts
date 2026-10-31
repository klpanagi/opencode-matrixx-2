import { log } from "../../shared/logger"
import { formatPollTimeoutOutcome } from "../../shared/poll-timeout-outcome"
import { fetchSessionMessages } from "../../shared/session-context-source"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, finishOf, idOf, isAssistant, roleOf, textOf, timeOf } from "../../shared/session-message"
import { DIAGNOSTIC_CAUSES, describeLastMessageParts, describeMessageShape } from "./diagnostic-shape"
import { getTimingConfig } from "./timing"
import type { NativeClient, ToolContextWithMetadata } from "./types"

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])

const STALL_NO_RESPONSE_POLLS = 15
const STALL_TOOL_CALLS_POLLS = 10
const STALL_ORPHANED_TOOL_CALL_POLLS = 20

/**
 * Created-at timestamp from the flat accessor, treating its 0 default as
 * "unknown" so the ID-comparison fallbacks still trigger for untimed messages.
 */
function createdAtOf(message: SessionMessage | undefined): number | undefined {
  if (!message) return undefined
  const created = timeOf(message)
  return created === 0 ? undefined : created
}

export function isSessionComplete(messages: SessionMessage[]): boolean {
  let lastUser: SessionMessage | undefined
  let lastAssistant: SessionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && isAssistant(msg)) lastAssistant = msg
    if (!lastUser && roleOf(msg) === "user") lastUser = msg
    if (lastUser && lastAssistant) break
  }

  const finish = finishOf(lastAssistant)
  if (!finish) return false
  if (NON_TERMINAL_FINISH_REASONS.has(finish)) return false

  // Both user and assistant messages required for chronological ordering
  if (!lastUser) return false

  // Prefer timestamp comparison (chronologically reliable over string ID ordering)
  const userTime = createdAtOf(lastUser)
  const assistantTime = createdAtOf(lastAssistant)
  if (userTime !== undefined && assistantTime !== undefined) {
    return userTime < assistantTime
  }

  // Fall back to string ID comparison when timestamps unavailable
  const userId = idOf(lastUser)
  const assistantId = idOf(lastAssistant)
  if (!userId || !assistantId) return false
  return userId < assistantId
}

export function hasToolResultAfterAssistant(messages: SessionMessage[]): boolean {
  let lastAssistant: SessionMessage | undefined
  let lastUser: SessionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && isAssistant(msg)) lastAssistant = msg
    if (!lastUser && roleOf(msg) === "user") lastUser = msg
    if (lastUser && lastAssistant) break
  }

  if (!lastAssistant || !lastUser) return false

  // Prefer timestamp comparison (chronologically reliable)
  const assistantTime = createdAtOf(lastAssistant)
  const userTime = createdAtOf(lastUser)
  if (userTime !== undefined && assistantTime !== undefined) {
    return userTime > assistantTime
  }

  // Fall back to string ID comparison when timestamps unavailable
  const assistantId = idOf(lastAssistant)
  const userId = idOf(lastUser)
  if (!assistantId || !userId) return false
  return userId > assistantId
}

export function hasAssistantContent(messages: SessionMessage[]): boolean {
  return messages.some((m) => isAssistant(m) && textOf(m).trim().length > 0)
}

export async function pollSyncSession(
  ctx: ToolContextWithMetadata,
  client: NativeClient,
  input: {
    sessionID: string
    agentToUse: string
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
    anchorMessageCount?: number
    /** Callback: does the parent session still have running background children? */
    hasActiveChildBackgroundTasks?: () => boolean
    /** Callback: is there a pending parent-wake notification in flight? */
    hasPendingParentWake?: () => boolean
  }
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(syncTiming.MAX_POLL_TIME_MS, 50)
  const pollStart = Date.now()
  let pollCount = 0
  let timedOut = false
  let idleStallCount = 0
  let lastMsgCount = 0
  let stableIdlePolls = 0

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse, maxPollTimeMs })

  while (Date.now() - pollStart < maxPollTimeMs) {
    if (ctx.abort?.aborted) {
      log("[task] Aborted by user", { sessionID: input.sessionID })
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted.\n\nSession ID: ${input.sessionID}`
    }

    await new Promise(resolve => setTimeout(resolve, syncTiming.POLL_INTERVAL_MS))
    pollCount++

    if (pollCount % 10 === 0) {
      log("[task] Poll progress", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: `${Math.floor((Date.now() - pollStart) / 1000)}s`,
        idleStallCount,
        stableIdlePolls,
      })
    }

    // Race-condition guard: if the parent session still has running background
    // children, or a parent-wake notification is in-flight, keep polling instead
    // of prematurely concluding the session is done.
    if (input.hasActiveChildBackgroundTasks?.() || input.hasPendingParentWake?.()) {
      idleStallCount = 0
      lastMsgCount = 0
      stableIdlePolls = 0
      continue
    }

    let msgs: SessionMessage[]
    try {
      msgs = await fetchSessionMessages(client, input.sessionID)
    } catch (error) {
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: String(error) })
      continue
    }

    if (input.anchorMessageCount !== undefined && msgs.length <= input.anchorMessageCount) {
      continue
    }

    if (isSessionComplete(msgs)) {
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    const lastAssistant = [...msgs].reverse().find((m) => isAssistant(m))
    const hasText = hasAssistantContent(msgs)

    if (!finishOf(lastAssistant) && hasText) {
      const elapsed = Date.now() - pollStart
      const stableReady = elapsed >= syncTiming.MIN_STABILITY_TIME_MS && stableIdlePolls >= syncTiming.STABILITY_POLLS_REQUIRED
      if (stableReady) {
        log("[task] Poll complete - assistant text detected (fallback, stability-gated)", {
          sessionID: input.sessionID,
          pollCount,
          elapsed,
          stableIdlePolls,
        })
        break
      } else {
        log("[task] Fallback text seen but stability gate not met, continuing", {
          sessionID: input.sessionID,
          pollCount,
          elapsed,
          stableIdlePolls,
          requiredPolls: syncTiming.STABILITY_POLLS_REQUIRED,
        })
      }
    }

    idleStallCount++

    if (!lastAssistant && idleStallCount >= STALL_NO_RESPONSE_POLLS) {
      log("[task] Session stalled - no assistant response after idle", {
        sessionID: input.sessionID,
        idleStallCount,
        pollCount,
      })
      return `Session stalled: no assistant response after ${idleStallCount} idle polls. Observed: ${describeMessageShape(msgs)}; last message part types: ${describeLastMessageParts(msgs)}. ${DIAGNOSTIC_CAUSES}\n\nSession ID: ${input.sessionID}`
    }

    const finishReason = finishOf(lastAssistant)
    if (finishReason && NON_TERMINAL_FINISH_REASONS.has(finishReason) && idleStallCount >= STALL_TOOL_CALLS_POLLS) {
      if (hasToolResultAfterAssistant(msgs)) {
        log("[task] Session stalled after tool call - tool result present but no new response", {
          sessionID: input.sessionID,
          finishReason,
          idleStallCount,
          pollCount,
        })
        break
      }

      if (idleStallCount >= STALL_ORPHANED_TOOL_CALL_POLLS) {
        log("[task] Session stalled - orphaned tool call with no result", {
          sessionID: input.sessionID,
          finishReason,
          idleStallCount,
          pollCount,
        })
        break
      }
    }

    if (lastAssistant && msgs.length > 0 && Date.now() - pollStart >= syncTiming.MIN_STABILITY_TIME_MS) {
      const currentMsgCount = msgs.length
      if (currentMsgCount === lastMsgCount) {
        stableIdlePolls++
        if (stableIdlePolls >= syncTiming.STABILITY_POLLS_REQUIRED) {
          log("[task] Poll complete - stable idle detected (message count unchanged)", {
            sessionID: input.sessionID,
            pollCount,
            stableIdlePolls,
            msgCount: currentMsgCount,
          })
          break
        }
      } else {
        stableIdlePolls = 0
        lastMsgCount = currentMsgCount
      }
    }
  }

  if (Date.now() - pollStart >= maxPollTimeMs) {
    timedOut = true
    log("[task] Poll timeout reached", { sessionID: input.sessionID, pollCount })
  }

  if (!timedOut) return null

  let lastAssistantText: string | undefined
  try {
    const timeoutMsgs = await fetchSessionMessages(client, input.sessionID)
    const lastAssistant = [...timeoutMsgs].reverse().find((m) => isAssistant(m))
    const textParts = contentOf(lastAssistant).filter((p) => p.type === "text" && p.text).map((p) => p.text as string)
    if (textParts.length > 0) lastAssistantText = textParts.join("\n")
  } catch {
    lastAssistantText = undefined
  }

  return formatPollTimeoutOutcome({
    sessionID: input.sessionID,
    agentToUse: input.agentToUse,
    maxPollTimeMs,
    lastAssistantText,
  })
}
