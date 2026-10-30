import type { BackgroundTask } from "../../features/background-agent"
import type { ContentPart, SessionMessage } from "../../shared/session-message"
import { contentOf, roleOf } from "../../shared/session-message"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatTaskStatus } from "./task-status-format"
import { formatMessageTime } from "./time-format"
import { truncateText } from "./truncate-text"

const MAX_MESSAGE_LIMIT = 100
const THINKING_MAX_CHARS = 2000

function extractToolResultText(part: ContentPart): string[] {
  const content = part.content
  if (typeof content === "string" && content.length > 0) {
    return [content]
  }

  if (Array.isArray(content)) {
    const blocks: string[] = []
    for (const block of content) {
      const record = block as { type?: string; text?: string }
      if ((record.type === "text" || record.type === "reasoning") && record.text) {
        blocks.push(record.text)
      }
    }
    if (blocks.length > 0) return blocks
  }

  const output = part.output
  if (typeof output === "string" && output.length > 0) {
    return [output]
  }

  return []
}

export async function formatFullSession(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: {
    includeThinking: boolean
    messageLimit?: number
    sinceMessageId?: string
    includeToolResults: boolean
    thinkingMaxChars?: number
  }
): Promise<string> {
  if (!task.sessionID) {
    return formatTaskStatus(task)
  }

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return `Error fetching messages: ${errorMessage}`
  }

  const rawMessages = extractMessages(messagesResult)
  if (!Array.isArray(rawMessages)) {
    return "Error fetching messages: invalid response"
  }

  const sortedMessages = [...rawMessages].sort((a, b) => {
    const timeA = String(a.time ?? "")
    const timeB = String(b.time ?? "")
    return timeA.localeCompare(timeB)
  })

  let filteredMessages = sortedMessages
  if (options.sinceMessageId) {
    const index = filteredMessages.findIndex((message) => message.id === options.sinceMessageId)
    if (index === -1) {
      return `Error: since_message_id not found: ${options.sinceMessageId}`
    }
    filteredMessages = filteredMessages.slice(index + 1)
  }

  const includeThinking = options.includeThinking
  const includeToolResults = options.includeToolResults
  const thinkingMaxChars = options.thinkingMaxChars ?? THINKING_MAX_CHARS

  const normalizedMessages: Array<{ message: SessionMessage; parts: ReadonlyArray<ContentPart> }> = []
  for (const message of filteredMessages) {
    const parts = contentOf(message).filter((part) => {
      if (part.type === "thinking" || part.type === "reasoning") {
        return includeThinking
      }
      if (part.type === "tool_result") {
        return includeToolResults
      }
      return part.type === "text"
    })

    if (parts.length === 0) {
      continue
    }

    normalizedMessages.push({ message, parts })
  }

  const limit = typeof options.messageLimit === "number" ? Math.min(options.messageLimit, MAX_MESSAGE_LIMIT) : undefined
  const hasMore = limit !== undefined && normalizedMessages.length > limit
  const visibleMessages = limit !== undefined ? normalizedMessages.slice(0, limit) : normalizedMessages

  const lines: string[] = []
  lines.push("# Full Session Output")
  lines.push("")
  lines.push(`Task ID: ${task.id}`)
  lines.push(`Description: ${task.description}`)
  lines.push(`Status: ${task.status}`)
  lines.push(`Session ID: ${task.sessionID}`)
  lines.push(`Total messages: ${normalizedMessages.length}`)
  lines.push(`Returned: ${visibleMessages.length}`)
  lines.push(`Has more: ${hasMore ? "true" : "false"}`)
  lines.push("")
  lines.push("## Messages")

  if (visibleMessages.length === 0) {
    lines.push("")
    lines.push("(No messages found)")
    return lines.join("\n")
  }

  for (const { message, parts } of visibleMessages) {
    const role = roleOf(message)
    const agent = message.agent ? " (" + message.agent + ")" : ""
    const time = formatMessageTime(message.time)
    const idLabel = message.id ? ` id=${message.id}` : ""
    lines.push("")
    lines.push(`[${role}${agent}] ${time}${idLabel}`)

    for (const part of parts) {
      if (part.type === "text" && typeof part.text === "string" && part.text) {
        lines.push(part.text.trim())
      } else if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking) {
        lines.push(`[thinking] ${truncateText(part.thinking, thinkingMaxChars)}`)
      } else if (part.type === "reasoning" && typeof part.text === "string" && part.text) {
        lines.push(`[thinking] ${truncateText(part.text, thinkingMaxChars)}`)
      } else if (part.type === "tool_result") {
        const toolTexts = extractToolResultText(part)
        for (const toolText of toolTexts) {
          lines.push(`[tool result] ${toolText}`)
        }
      }
    }
  }

  return lines.join("\n")
}
