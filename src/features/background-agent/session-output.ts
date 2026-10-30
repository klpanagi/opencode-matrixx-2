import { log, normalizeSDKResponse } from "../../shared"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, roleOf } from "../../shared/session-message"

export interface SessionOutputClient {
  session: {
    messages: (args: { path: { id: string } }) => Promise<unknown>
  }
}

export type { SessionMessage }

/**
 * Fetch the raw messages for a session. Throws on transport failure so callers
 * can decide between fail-open (legacy) and fail-safe (reconciliation).
 */
export async function fetchSessionMessages(
  client: SessionOutputClient,
  sessionID: string,
): Promise<SessionMessage[]> {
  const response = await client.session.messages({ path: { id: sessionID } })
  return normalizeSDKResponse(response, [] as SessionMessage[], { preferResponseOnMissingData: true })
}

/**
 * True when the session produced real assistant/tool output with content.
 * Shared by `validateSessionHasOutput` (manager) and `reconcileHandle`.
 */
export function messagesHaveAssistantOutput(
  messages: SessionMessage[],
  sessionID?: string,
): boolean {
  const hasAssistantOrToolMessage = messages.some((m) => {
    const role = roleOf(m)
    return role === "assistant" || role === "tool"
  })
  if (!hasAssistantOrToolMessage) {
    if (sessionID) log("[background-agent] No assistant/tool messages found in session:", sessionID)
    return false
  }

  const hasContent = messages.some((m) => {
    const role = roleOf(m)
    if (role !== "assistant" && role !== "tool") return false
    return contentOf(m).some((p) => {
      const text = typeof p.text === "string" ? p.text : undefined
      if ((p.type === "text" || p.type === "reasoning") && text && text.trim().length > 0) return true
      if (p.type === "tool") return true
      if (p.type === "tool_result") {
        const raw = p.content
        if (typeof raw === "string") return raw.trim().length > 0
        if (Array.isArray(raw)) return raw.length > 0
      }
      return false
    })
  })

  if (!hasContent && sessionID) {
    log("[background-agent] Messages exist but no content found in session:", sessionID)
  }
  return hasContent
}

/** True when any assistant message carries a recorded provider/abort error. */
export function messagesHaveRecordedError(messages: SessionMessage[]): boolean {
  return messages.some((m) => roleOf(m) === "assistant" && m.error != null)
}

/**
 * Validate that a session has actual assistant/tool output before marking
 * complete. Fail-open: transport errors return true so a flaky lookup cannot
 * block the existing polling/idle completion path.
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
