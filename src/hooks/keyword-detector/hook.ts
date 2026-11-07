import type { ContextCollector } from "../../features/context-injection/injector"
import { getRedpillState } from "../../features/redpill-state"
import {
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
} from "../../features/session-state/state"
import { log } from "../../shared"
import { notify } from "../../shared/runtime/notify"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import {
  isSystemDirective,
  sanitizeKnownTags,
} from "../../shared/text/system-directive"
import { isPlannerAgent } from "./constants"
import { detectKeywordsWithType, extractPromptText } from "./detector"

export function createKeywordDetectorHook(_ctx: NativePluginContext, _collector?: ContextCollector) {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)

      if (isSystemDirective(promptText)) {
        log(`[keyword-detector] Skipping system directive message`, { sessionID: input.sessionID })
        return
      }

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent

      // Strip known tags to prevent automated system messages from triggering mode keywords
      const cleanText = sanitizeKnownTags(promptText, { presentation: "drop" })
      const modelID = input.model?.modelID
      let detectedKeywords = detectKeywordsWithType(cleanText, currentAgent, modelID)

      if (isPlannerAgent(currentAgent)) {
        detectedKeywords = detectedKeywords.filter((k) => k.type !== "redpill")
      }

      if (detectedKeywords.length === 0) {
        return
      }

      // Skip keyword detection for background task sessions to prevent mode injection
      // (e.g., [analyze-mode]) which incorrectly triggers Oracle restrictions
      const isBackgroundTaskSession = subagentSessions.has(input.sessionID)
      if (isBackgroundTaskSession) {
        return
      }

      const mainSessionID = getMainSessionID()
      const isNonMainSession = mainSessionID && input.sessionID !== mainSessionID

      if (isNonMainSession) {
        detectedKeywords = detectedKeywords.filter((k) => k.type === "redpill")
        if (detectedKeywords.length === 0) {
          log(`[keyword-detector] Skipping non-redpill keywords in non-main session`, {
            sessionID: input.sessionID,
            mainSessionID,
          })
          return
        }
      }

      const redpillState = getRedpillState(input.sessionID)
      const hasRedpill = detectedKeywords.some((k) => k.type === "redpill")
      const isRedpillBlocked = redpillState === "disabled"
      const isRedpillForced = redpillState === "enabled"

      if (isRedpillBlocked) {
        log(`[keyword-detector] Redpill blocked by runtime state`, { sessionID: input.sessionID })
        return
      }

      if (hasRedpill || isRedpillForced) {
        log(`[keyword-detector] Redpill mode activated`, { sessionID: input.sessionID })

        if (output.message.variant === undefined) {
          output.message.variant = "max"
        }

        notify("success", "Redpill Mode Activated: Maximum precision engaged. All agents at your disposal.")
      }

      const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text !== undefined)
      if (textPartIndex === -1) {
        log(`[keyword-detector] No text part found, skipping injection`, { sessionID: input.sessionID })
        return
      }

      const allMessages = detectedKeywords.map((k) => k.message).join("\n\n")
      const originalText = output.parts[textPartIndex].text ?? ""

      output.parts[textPartIndex].text = `${allMessages}\n\n---\n\n${originalText}`

      log(`[keyword-detector] Detected ${detectedKeywords.length} keywords`, {
        sessionID: input.sessionID,
        types: detectedKeywords.map((k) => k.type),
      })
    },
  }
}
