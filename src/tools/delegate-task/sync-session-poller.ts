import { formatPollTimeoutOutcome } from "../../shared/outcome/poll-timeout-outcome"
import { log } from "../../shared/runtime/logger"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import type { SessionMessage } from "../../shared/session/session-message"
import { contentOf, finishOf, idOf, isAssistant, roleOf, textOf, timeOf } from "../../shared/session/session-message"
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

/**
 * `time.completed` from the flat message shape. The shared `session-message`
 * surface is frozen (see tests/shared/no-v1-shape.test.ts), so this accessor
 * lives with its only consumer instead of graduating into `shared/`.
 */
export function completedOf(message: unknown): number | undefined {
  const completed = (message as { time?: { completed?: number } } | null | undefined)?.time?.completed
  // Epoch zero is never a real completion stamp — treat it as absent so the
  // host-publishes-completion capability probe stays honest.
  return typeof completed === "number" && completed > 0 ? completed : undefined
}

/**
 * OpenCode V2 publishes `time.completed` on assistant messages: the row is
 * created when a step starts and completed when it ends, so an assistant
 * message without `time.completed` is still streaming. Older payloads (and
 * test corpora) never carry the field — when no assistant message in the
 * observed set carries it, the host does not expose completion and every
 * message must be treated as settled.
 */
export function isStreamingAssistant(
  message: SessionMessage | undefined,
  messages: SessionMessage[],
): boolean {
  if (!message || !isAssistant(message)) return false
  const hostPublishesCompletion = messages.some(
    (candidate) => isAssistant(candidate) && completedOf(candidate) !== undefined,
  )
  if (!hostPublishesCompletion) return false
  return completedOf(message) === undefined
}

function strippedAssistantText(message: SessionMessage): string {
  return textOf(message).replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim()
}

function lastAssistantHasText(message: SessionMessage | undefined): boolean {
  if (!message) return false
  return strippedAssistantText(message).length > 0
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
  if (isStreamingAssistant(lastAssistant, messages)) return false

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
  return messages.some((m) => isAssistant(m) && strippedAssistantText(m).length > 0)
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
  const maxPollTimeMs = Math.max(syncTiming.MAX_POLL_TIME_MS, syncTiming.MIN_POLL_TIME_FLOOR_MS)
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

    // The host created a row for the step that is still streaming: its content is
    // empty and its finish is not trustworthy yet. Count-based stability, the
    // text fallback, and every stall heuristic would all misread that state, so
    // reset them and keep polling until the step settles.
    if (isStreamingAssistant(lastAssistant, msgs)) {
      idleStallCount = 0
      lastMsgCount = 0
      stableIdlePolls = 0
      continue
    }

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

    if (
      lastAssistant &&
      msgs.length > 0 &&
      Date.now() - pollStart >= syncTiming.MIN_STABILITY_TIME_MS &&
      !isStreamingAssistant(lastAssistant, msgs) &&
      lastAssistantHasText(lastAssistant)
    ) {
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
    // Skip any row still streaming at timeout: quoting half-written text as the
    // outcome would repeat the very bug this guard exists to prevent.
    const lastAssistant = [...timeoutMsgs]
      .reverse()
      .find((m) => isAssistant(m) && !isStreamingAssistant(m, timeoutMsgs))
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
