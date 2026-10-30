import { contentOf, roleOf, textOf } from "../../shared/session-message"
import { extractSessionMessages } from "./session-messages"

export function getLastUserRetryParts(
  messagesResponse: unknown,
): Array<{ type: "text"; text: string }> {
  const messages = extractSessionMessages(messagesResponse)
  const lastUserMessage = messages?.filter((message) => roleOf(message) === "user").pop()
  if (!lastUserMessage) return []

  const fromContent = contentOf(lastUserMessage)
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text"
        && typeof part.text === "string"
        && part.text.length > 0,
    )
    .map((part) => ({ type: "text" as const, text: part.text }))

  if (fromContent.length > 0) return fromContent

  const flatText = textOf(lastUserMessage)
  return flatText.length > 0 ? [{ type: "text" as const, text: flatText }] : []
}
