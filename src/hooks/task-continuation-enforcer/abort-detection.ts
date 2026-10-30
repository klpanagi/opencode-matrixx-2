import { roleOf } from "../../shared/session-message"
import type { MessageInfo } from "./types"

export function isLastAssistantMessageAborted(
  messages: Array<MessageInfo>
): boolean {
  if (!messages || messages.length === 0) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (roleOf(message) !== "assistant") continue

    const errorName = message.error?.name
    if (!errorName) return false
    return errorName === "MessageAbortedError" || errorName === "AbortError"
  }

  return false
}
