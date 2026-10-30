import type { ExperimentalConfig } from "../../config"
import { log } from "../../shared/logger"
import { notify } from "../../shared/notify"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { idOf } from "../../shared/session-message"
import type { RecoveryErrorType } from "./detect-error-type"
import { detectErrorType } from "./detect-error-type"
import { recoverThinkingBlockOrder } from "./recover-thinking-block-order"
import { recoverThinkingDisabledViolation } from "./recover-thinking-disabled-violation"
import { recoverToolResultMissing } from "./recover-tool-result-missing"
import { extractResumeConfig, findLastUserMessage, resumeSession } from "./resume"

interface MessageInfo {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

export interface SessionRecoveryOptions {
  experimental?: ExperimentalConfig
}

export interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
}

export function createSessionRecoveryHook(ctx: NativePluginContext, options?: SessionRecoveryOptions): SessionRecoveryHook {
  const processingErrors = new Set<string>()
  const experimental = options?.experimental
  let onAbortCallback: ((sessionID: string) => void) | null = null
  let onRecoveryCompleteCallback: ((sessionID: string) => void) | null = null

  const setOnAbortCallback = (callback: (sessionID: string) => void): void => {
    onAbortCallback = callback
  }

  const setOnRecoveryCompleteCallback = (callback: (sessionID: string) => void): void => {
    onRecoveryCompleteCallback = callback
  }

  const isRecoverableError = (error: unknown): boolean => {
    return detectErrorType(error) !== null
  }

  const handleSessionRecovery = async (info: MessageInfo): Promise<boolean> => {
    if (info?.role !== "assistant" || !info.error) return false

    const errorType = detectErrorType(info.error)
    if (!errorType) return false

    const sessionID = info.sessionID
    const assistantMsgID = info.id

    if (!sessionID || !assistantMsgID) return false
    if (processingErrors.has(assistantMsgID)) return false
    processingErrors.add(assistantMsgID)

    try {
      if (onAbortCallback) {
        onAbortCallback(sessionID)
      }

      await ctx.session.interrupt({ sessionID }).catch((err) => { log("[session-recovery] Session abort failed:", err) })

      const msgs = await fetchSessionMessages(ctx, sessionID)

      const failedMsg = msgs?.find((m) => idOf(m) === assistantMsgID)
      if (!failedMsg) {
        return false
      }

      const toastTitles: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Tool Crash Recovery",
        thinking_block_order: "Thinking Block Recovery",
        thinking_disabled_violation: "Thinking Strip Recovery",
        "assistant_prefill_unsupported": "Prefill Unsupported",
      }
      const toastMessages: Record<RecoveryErrorType & string, string> = {
        tool_result_missing: "Injecting cancelled tool results...",
        thinking_block_order: "Fixing message structure...",
        thinking_disabled_violation: "Stripping thinking blocks...",
        "assistant_prefill_unsupported": "Prefill not supported; continuing without recovery.",
      }

      notify("warn", `${toastTitles[errorType]}: ${toastMessages[errorType]}`)

      let success = false

      if (errorType === "tool_result_missing") {
        success = await recoverToolResultMissing(ctx, sessionID, failedMsg)
      } else if (errorType === "thinking_block_order") {
        success = await recoverThinkingBlockOrder(ctx, sessionID, failedMsg, ctx.directory, info.error)
        if (success && experimental?.auto_resume) {
          const lastUser = findLastUserMessage(msgs ?? [])
          const resumeConfig = extractResumeConfig(lastUser, sessionID)
          await resumeSession(ctx, resumeConfig)
        }
      } else if (errorType === "thinking_disabled_violation") {
        success = await recoverThinkingDisabledViolation(ctx, sessionID, failedMsg)
        if (success && experimental?.auto_resume) {
          const lastUser = findLastUserMessage(msgs ?? [])
          const resumeConfig = extractResumeConfig(lastUser, sessionID)
          await resumeSession(ctx, resumeConfig)
        }
      } else if (errorType === "assistant_prefill_unsupported") {
        success = false
      }

      return success
    } catch (err) {
      log("[session-recovery] Recovery failed:", err)
      return false
    } finally {
      processingErrors.delete(assistantMsgID)

      if (sessionID && onRecoveryCompleteCallback) {
        onRecoveryCompleteCallback(sessionID)
      }
    }
  }

  return {
    handleSessionRecovery,
    isRecoverableError,
    setOnAbortCallback,
    setOnRecoveryCompleteCallback,
  }
}
