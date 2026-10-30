import { promptNativeWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import type { SessionDomainLike } from "../../shared/session-context-source"
import { roleOf } from "../../shared/session-message"
import type { MessageData, ResumeConfig } from "./types"

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"

type Client = { session: SessionDomainLike }

export function findLastUserMessage(messages: MessageData[]): MessageData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") {
      return messages[i]
    }
  }
  return undefined
}

export function extractResumeConfig(userMessage: MessageData | undefined, sessionID: string): ResumeConfig {
  return {
    sessionID,
    agent: userMessage?.agent,
    model:
      userMessage?.model?.providerID && userMessage.model.modelID
        ? { providerID: userMessage.model.providerID, modelID: userMessage.model.modelID }
        : undefined,
  }
}

export async function resumeSession(client: Client, config: ResumeConfig): Promise<boolean> {
  try {
    await promptNativeWithModelSuggestionRetry(client.session, {
      sessionID: config.sessionID,
      parts: [{ type: "text", text: RECOVERY_RESUME_TEXT }],
      agent: config.agent,
      model: config.model,
    })
    return true
  } catch {
    return false
  }
}
