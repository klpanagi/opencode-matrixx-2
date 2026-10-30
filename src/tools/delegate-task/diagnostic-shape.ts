import type { SessionMessage } from "../../shared/session-message"
import { contentOf, isAssistant, roleOf, textOf } from "../../shared/session-message"

const MAX_LISTED = 6

export const DIAGNOSTIC_CAUSES =
  "Either the child model produced no assistant message, or the returned messages do not match the expected flat shape."

function summarize(values: string[]): string {
  if (values.length === 0) return "none"
  const head = values.slice(-MAX_LISTED)
  const hidden = values.length - head.length
  return hidden > 0 ? `${head.join(",")},+${hidden} more` : head.join(",")
}

export function describeMessageShape(messages: SessionMessage[]): string {
  const assistantCount = messages.filter((message) => isAssistant(message)).length
  const roles = messages.map((message) => roleOf(message))
  return `${messages.length} messages, ${assistantCount} assistant (roles: ${summarize(roles)})`
}

export function describeLastMessageParts(messages: SessionMessage[]): string {
  const last = messages[messages.length - 1]
  const types = contentOf(last).map((part) => part.type ?? "unknown")
  if (types.length > 0) return types.join(",")
  // Flat messages keep their text outside the content array.
  return textOf(last).length > 0 ? "text" : "none"
}
