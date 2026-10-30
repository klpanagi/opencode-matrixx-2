import { promptNativeWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import type { SessionDomainLike } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { contentOf, idOf } from "../../shared/session-message"
import { readParts } from "./storage"
import type { MessageData } from "./types"

type Client = { session: SessionDomainLike }

interface RawPart {
  type?: string
  id?: string
  callID?: string
}

function idsOfParts(parts: ReadonlyArray<RawPart>): string[] {
  const ids: string[] = []
  for (const part of parts) {
    if (part.type !== "tool_use" && part.type !== "tool") continue
    const id = typeof part.callID === "string" ? part.callID : typeof part.id === "string" ? part.id : undefined
    if (id) ids.push(id)
  }
  return ids
}

function extractToolUseIds(message: unknown): string[] {
  return idsOfParts(contentOf(message))
}

export async function recoverToolResultMissing(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData
): Promise<boolean> {
  let toolUseIds = extractToolUseIds(failedAssistantMsg)
  const messageID = idOf(failedAssistantMsg)

  if (toolUseIds.length === 0 && messageID) {
    if (isSqliteBackend()) {
      try {
        const messages = await fetchSessionMessages(client, sessionID)
        const target = messages.find((m) => idOf(m) === messageID)
        toolUseIds = target ? extractToolUseIds(target) : []
      } catch {
        toolUseIds = []
      }
    } else {
      toolUseIds = idsOfParts(readParts(messageID) as ReadonlyArray<RawPart>)
    }
  }

  if (toolUseIds.length === 0) {
    return false
  }

  try {
    await promptNativeWithModelSuggestionRetry(client.session, {
      sessionID,
      parts: [
        {
          type: "text",
          text: `Tool operations were interrupted. ${toolUseIds.length} tool call(s) did not complete. Please acknowledge and continue.`,
        },
      ],
    })

    return true
  } catch {
    return false
  }
}
