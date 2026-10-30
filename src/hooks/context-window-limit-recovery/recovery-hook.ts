// Boundary: reactive only (parses token_limit errors on session.error/message.updated/session.idle). Proactive compression belongs to DCP (/dcp-compress). Do not add proactive thresholds here. Cap API calls 2.

import type { ExperimentalConfig } from "../../config"
import type { V2Event } from "../../plugin/context"
import { log } from "../../shared/logger"
import { notify } from "../../shared/notify"
import type { NativePluginContext } from "../../shared/session-context-source"
import { executeCompact, getLastAssistant } from "./executor"
import { parseTokenLimitError } from "./parser"
import type { AutoCompactState, ParsedTokenLimitError } from "./types"
export interface AnthropicContextWindowLimitRecoveryOptions {
  experimental?: ExperimentalConfig
}

function createRecoveryState(): AutoCompactState {
  return {
    pendingCompact: new Set<string>(),
    errorDataBySession: new Map<string, ParsedTokenLimitError>(),
    retryStateBySession: new Map(),
    truncateStateBySession: new Map(),
    emptyContentAttemptBySession: new Map(),
    compactionInProgress: new Set<string>(),
  }
}


export function createAnthropicContextWindowLimitRecoveryHook(
  ctx: NativePluginContext,
  options?: AnthropicContextWindowLimitRecoveryOptions,
) {
  const autoCompactState = createRecoveryState()
  const experimental = options?.experimental
  const pendingCompactionTimeoutBySession = new Map<string, ReturnType<typeof setTimeout>>()

  const eventHandler = async (event: V2Event) => {
    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        const timeoutID = pendingCompactionTimeoutBySession.get(sessionInfo.id)
        if (timeoutID !== undefined) {
          clearTimeout(timeoutID)
          pendingCompactionTimeoutBySession.delete(sessionInfo.id)
        }

        autoCompactState.pendingCompact.delete(sessionInfo.id)
        autoCompactState.errorDataBySession.delete(sessionInfo.id)
        autoCompactState.retryStateBySession.delete(sessionInfo.id)
        autoCompactState.truncateStateBySession.delete(sessionInfo.id)
        autoCompactState.emptyContentAttemptBySession.delete(sessionInfo.id)
        autoCompactState.compactionInProgress.delete(sessionInfo.id)
      }
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      log("[auto-compact] session.error received", { sessionID, error: props?.error })
      if (!sessionID) return

      const parsed = parseTokenLimitError(props?.error)
      log("[auto-compact] parsed result", { parsed, hasError: !!props?.error })
      if (parsed) {
        autoCompactState.pendingCompact.add(sessionID)
        autoCompactState.errorDataBySession.set(sessionID, parsed)

        if (autoCompactState.compactionInProgress.has(sessionID)) return

        const lastAssistant = await getLastAssistant(sessionID, ctx)
        const lastModel = lastAssistant?.model as { providerID?: string; modelID?: string } | undefined
        const providerID = parsed.providerID ?? lastModel?.providerID
        const modelID = parsed.modelID ?? lastModel?.modelID

        notify("warn", "Context Limit Hit: Truncating large tool outputs and recovering...")

        const timeoutID = setTimeout(() => {
          pendingCompactionTimeoutBySession.delete(sessionID)
          executeCompact(
            sessionID,
            { providerID, modelID },
            autoCompactState,
            ctx,
            ctx.directory,
            experimental,
          )
        }, 300)

        pendingCompactionTimeoutBySession.set(sessionID, timeoutID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined

      if (sessionID && info?.role === "assistant" && info.error) {
        log("[auto-compact] message.updated with error", { sessionID, error: info.error })
        const parsed = parseTokenLimitError(info.error)
        log("[auto-compact] message.updated parsed result", { parsed })
        if (parsed) {
          parsed.providerID = info.providerID as string | undefined
          parsed.modelID = info.modelID as string | undefined
          autoCompactState.pendingCompact.add(sessionID)
          autoCompactState.errorDataBySession.set(sessionID, parsed)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (!autoCompactState.pendingCompact.has(sessionID)) return

      const timeoutID = pendingCompactionTimeoutBySession.get(sessionID)
      if (timeoutID !== undefined) {
        clearTimeout(timeoutID)
        pendingCompactionTimeoutBySession.delete(sessionID)
      }

      const errorData = autoCompactState.errorDataBySession.get(sessionID)
      const lastAssistant = await getLastAssistant(sessionID, ctx)

      if (lastAssistant?.summary === true) {
        autoCompactState.pendingCompact.delete(sessionID)
        return
      }

      const lastModel = lastAssistant?.model as { providerID?: string; modelID?: string } | undefined
      const providerID = errorData?.providerID ?? lastModel?.providerID
      const modelID = errorData?.modelID ?? lastModel?.modelID

      notify("warn", "Auto Compact: Token limit exceeded. Attempting recovery...")

      await executeCompact(
        sessionID,
        { providerID, modelID },
        autoCompactState,
        ctx,
        ctx.directory,
        experimental,
      )
    }
  }

  return {
    event: eventHandler,
  }
}

export type ContextWindowLimitRecoveryOptions = AnthropicContextWindowLimitRecoveryOptions
export const createContextWindowLimitRecoveryHook = createAnthropicContextWindowLimitRecoveryHook
