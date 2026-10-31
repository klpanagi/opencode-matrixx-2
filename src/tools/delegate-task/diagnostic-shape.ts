import type { SessionMessage } from "../../shared/session-message"
import { contentOf, isAssistant, roleOf, textOf } from "../../shared/session-message"

const MAX_LISTED = 6

export const DIAGNOSTIC_CAUSES =
  "Classified causes: (1) child produced no assistant message (empty model output / permission-denied delegation inside child); (2) messages exist but do not match the expected flat shape; (3) delegation was issued from inside code-mode (task has codemode:false) or with a permission-denied tool. Check /tmp/matrixx.log delegate-task entries for session ID."

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
