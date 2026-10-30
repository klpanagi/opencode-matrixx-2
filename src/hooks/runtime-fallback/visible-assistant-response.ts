import { fetchSessionMessages } from "../../shared/session-context-source"
import { contentOf, isAssistant, roleOf } from "../../shared/session-message"
import type { extractAutoRetrySignal } from "./error-classifier"
import type { SessionMessage, SessionMessagePart } from "./session-messages"
import { extractSessionMessages } from "./session-messages"
import type { HookDeps } from "./types"

function getLastUserMessageIndex(messages: SessionMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (roleOf(messages[index]) === "user") {
      return index
    }
  }

  return -1
}

function getAssistantText(parts: ReadonlyArray<SessionMessagePart> | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (part.type !== "text") {
        return []
      }

      const text = typeof part.text === "string" ? part.text.trim() : ""
      return text.length > 0 ? [text] : []
    })
    .join("\n")
}

export function hasVisibleAssistantResponse(extractAutoRetrySignalFn: typeof extractAutoRetrySignal) {
  return async (
    ctx: HookDeps["ctx"],
    sessionID: string,
    _info: Record<string, unknown> | undefined,
  ): Promise<boolean> => {
    try {
      const messagesResponse = await fetchSessionMessages(ctx, sessionID)
      const messages = extractSessionMessages(messagesResponse)
      if (!messages || messages.length === 0) return false

      const lastUserMessageIndex = getLastUserMessageIndex(messages)
      if (lastUserMessageIndex === -1) return false

      for (let index = lastUserMessageIndex + 1; index < messages.length; index++) {
        const message = messages[index]
        if (!isAssistant(message)) {
          continue
        }

        if (message.error) {
          continue
        }

        const assistantText = getAssistantText(contentOf(message))
        if (!assistantText) {
          continue
        }

        if (extractAutoRetrySignalFn({ message: assistantText })) {
          continue
        }

        return true
      }

      return false
    } catch {
      return false
    }
  }
}
