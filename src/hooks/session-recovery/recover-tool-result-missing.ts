import type { createOpencodeClient } from "@opencode-ai/sdk"
import { normalizeSDKResponse } from "../../shared"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { contentOf, idOf } from "../../shared/session-message"
import { readParts } from "./storage"
import type { MessageData } from "./types"

type Client = ReturnType<typeof createOpencodeClient>

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
        const response = await client.session.messages({ path: { id: sessionID } })
        const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
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
    await promptWithModelSuggestionRetry(client, {
      path: { id: sessionID },
      body: {
        parts: [
          {
            type: "text",
            text: "Tool operations were interrupted. " + toolUseIds.length + " tool call(s) did not complete. Please acknowledge and continue.",
          },
        ],
      },
    })

    return true
  } catch {
    return false
  }
}
