import { log } from "../../../shared"
import type { SessionContextCarrier } from "../../../shared/session/session-context-source"
import { fetchSessionMessages as fetchNativeSessionMessages } from "../../../shared/session/session-context-source"
import type { SessionMessage } from "../../../shared/session/session-message"
import { contentOf, roleOf } from "../../../shared/session/session-message"

export type SessionOutputClient = SessionContextCarrier

export type { SessionMessage }

export async function fetchSessionMessages(
  client: SessionOutputClient,
  sessionID: string,
): Promise<SessionMessage[]> {
  return fetchNativeSessionMessages(client, sessionID)
}

export function stripAnalysisBlocks(text: string): string {
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim()
}

function isAssistantOrToolMessage(message: SessionMessage): boolean {
  const role = roleOf(message)
  return role === "assistant" || role === "tool"
}

function hasSubstantiveContent(message: SessionMessage): boolean {
  return contentOf(message).some((part) => {
    const text = typeof part.text === "string" ? stripAnalysisBlocks(part.text) : undefined
    if ((part.type === "text" || part.type === "reasoning") && text && text.trim().length > 0) {
      return true
    }
    if (part.type === "tool") return true
    if (part.type === "tool_result") {
      const raw = part.content
      if (typeof raw === "string") return stripAnalysisBlocks(raw).length > 0
      if (Array.isArray(raw)) return raw.length > 0
    }
    return false
  })
}

/**
 * D1: only a session with zero assistant AND zero tool messages is incomplete.
 * Analysis-only content completes with one warning so a planning preamble can
 * never block the terminal transition.
 */
export function messagesHaveAssistantOutput(
  messages: SessionMessage[],
  sessionID?: string,
): boolean {
  const hasAssistantOrTool = messages.some(isAssistantOrToolMessage)
  if (!hasAssistantOrTool) {
    if (sessionID) log("[background-agent] No assistant/tool messages found in session:", sessionID)
    return false
  }

  const hasContent = messages.some(
    (message) => isAssistantOrToolMessage(message) && hasSubstantiveContent(message),
  )
  if (!hasContent && sessionID) {
    log("[background-agent] Analysis-only output treated as completed:", sessionID)
  }
  return true
}

export function messagesHaveRecordedError(messages: SessionMessage[]): boolean {
  return messages.some((message) => roleOf(message) === "assistant" && message.error != null)
}

/**
 * Fail-open: a transport error returns true so a flaky lookup cannot block a
 * real completion. Zero assistant/tool messages return false.
 */
export async function validateSessionHasOutput(
  client: SessionOutputClient,
  sessionID: string,
): Promise<boolean> {
  try {
    const messages = await fetchSessionMessages(client, sessionID)
    return messagesHaveAssistantOutput(messages, sessionID)
  } catch (error) {
    log("[background-agent] Error validating session output:", error)
    return true
  }
}
