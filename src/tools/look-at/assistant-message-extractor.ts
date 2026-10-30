import { contentOf, isAssistant, timeOf } from "../../shared/session-message"

export function extractLatestAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null

  const assistantMessages = messages
    .filter((message) => isAssistant(message))
    .sort((a, b) => timeOf(b) - timeOf(a))

  const lastAssistantMessage = assistantMessages[0]
  if (!lastAssistantMessage) return null

  const textParts = contentOf(lastAssistantMessage).filter((part) => part.type === "text" && part.text)
  return textParts.map((part) => part.text ?? "").join("\n")
}
