import type { BackgroundTask } from "../../features/background-agent"
import { formatDuration } from "../../shared"
import { fetchSessionMessages, type SessionContextCarrier } from "../../shared/session-context-source"
import { consumeNewMessages } from "../../shared/session-cursor"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, roleOf } from "../../shared/session-message"

function getTimeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export async function formatTaskResult(task: BackgroundTask, client: SessionContextCarrier): Promise<string> {
  if (task.compactedResult) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---
${task.compactedResult}`
  }

  if (!task.sessionID) {
    return `Error: Task has no sessionID`
  }

  let messages: SessionMessage[]
  try {
    messages = await fetchSessionMessages(client, task.sessionID)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error fetching messages: ${message}`
  }
  if (messages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No messages found)`
  }

  const relevantMessages = messages.filter((m) => roleOf(m) === "assistant" || roleOf(m) === "tool")
  if (relevantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No assistant or tool response found)`
  }

  const sortedMessages = [...relevantMessages].sort((a, b) => {
    const timeA = getTimeString(a.time)
    const timeB = getTimeString(b.time)
    return timeA.localeCompare(timeB)
  })

  const newMessages = consumeNewMessages(task.sessionID, sortedMessages)
  if (newMessages.length === 0) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

(No new output since last check)`
  }

  const extractedContent: string[] = []
  for (const message of newMessages) {
    for (const part of contentOf(message)) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text)
        continue
      }

      if (part.type === "tool_result") {
        const toolResult = part as { content?: string | Array<{ type: string; text?: string }> }
        if (typeof toolResult.content === "string" && toolResult.content) {
          extractedContent.push(toolResult.content)
          continue
        }

        if (Array.isArray(toolResult.content)) {
          for (const block of toolResult.content) {
            if ((block.type === "text" || block.type === "reasoning") && block.text) {
              extractedContent.push(block.text)
            }
          }
        }
      }
    }
  }

  const textContent = extractedContent.filter((text) => text.length > 0).join("\n\n")
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent || "(No text output)"}`
}
