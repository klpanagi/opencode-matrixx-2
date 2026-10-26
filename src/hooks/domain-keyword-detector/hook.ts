import { log } from "../../shared"
import { isSystemDirective, sanitizeKnownTags } from "../../shared/system-directive"
import { DOMAIN_HINT_MARKER } from "./constants"
import { buildDomainHint, detectDomainSkills } from "./detector"

interface TransformMessage {
  info: { role?: string }
  parts: Array<{ type?: string; text?: string }>
}

type MessagesTransformOutput = { messages: TransformMessage[] }

/**
 * Routes the last user message to finance-domain skills.
 *
 * Runs on `experimental.chat.messages.transform`: it detects domain keywords
 * (ccxt, zeromq, influxdb, grafana, telegram, websocket, perpetual/basis,
 * unified symbols, asyncio, market data, silent failures) and prepends a
 * compact, capped hint naming the matching skills. Pure routing — no file IO,
 * never blocks, and idempotent via the `[domain-skills]` marker.
 */
export function createDomainKeywordDetectorHook() {
  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: MessagesTransformOutput,
    ): Promise<void> => {
      const { messages } = output
      if (!messages || messages.length === 0) return

      const lastUserMessage = messages.findLast((message) => message.info.role === "user")
      if (!lastUserMessage) return

      const textPartIndex = lastUserMessage.parts.findIndex(
        (part) => part.type === "text" && typeof part.text === "string",
      )
      if (textPartIndex === -1) return

      const textPart = lastUserMessage.parts[textPartIndex]
      const originalText = textPart.text ?? ""
      if (originalText.includes(DOMAIN_HINT_MARKER)) return
      if (isSystemDirective(originalText)) return

      const cleanText = sanitizeKnownTags(originalText, { presentation: "drop" })
      const skills = detectDomainSkills(cleanText)
      if (skills.length === 0) return

      textPart.text = `${buildDomainHint(skills)}\n\n---\n\n${originalText}`

      log("[domain-keyword-detector] Injected domain skills", { skills })
    },
  }
}
