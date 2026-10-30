import { isRecord } from "../../shared/record-type-guard"
import type { ContentPart, SessionMessage } from "../../shared/session-message"

export type { SessionMessage } from "../../shared/session-message"
export type SessionMessagePart = ContentPart


function isSessionMessage(value: unknown): value is SessionMessage {
  return isRecord(value)
}

function isSessionMessageArray(value: unknown): value is SessionMessage[] {
  return Array.isArray(value) && value.every(isSessionMessage)
}

export function extractSessionMessages(messagesResponse: unknown): SessionMessage[] | undefined {
  if (isSessionMessageArray(messagesResponse)) {
    return messagesResponse
  }

  if (!isRecord(messagesResponse)) {
    return undefined
  }

  const data = messagesResponse.data
  if (isSessionMessageArray(data)) {
    return data
  }

  return undefined
}
