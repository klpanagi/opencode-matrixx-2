import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { promptNativeWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { setSessionTemperature, setSessionTools } from "../../shared/session-state"
import { isPlanFamily } from "./constants"
import { formatDetailedError } from "./error-formatting"
import type { DelegateTaskArgs, NativeClient } from "./types"

type SendSyncPromptDeps = {
  sendNativePrompt: typeof promptNativeWithModelSuggestionRetry
}

const sendSyncPromptDeps: SendSyncPromptDeps = {
  sendNativePrompt: promptNativeWithModelSuggestionRetry,
}

// Native v2 session.prompt payload: { sessionID, text } plus optional file/agent/
// skill attachments. There is no per-message agent/model/system/tools selection
// on this endpoint: agent and model are pinned at session.create, tools and
// temperature flow through the local session-state stores, and per-task system
// instructions are prepended to the user text by the caller.
export interface SyncPromptV2Args {
  sessionID: string
  text: string
  [key: string]: unknown
}

function isAgentNotFoundError(message: string, agent: string): boolean {
  if (message.includes("agent.name")) return true
  if (message.includes(`"${agent}"`) && /not found|unknown agent|not registered/i.test(message)) return true
  return /unknown agent/i.test(message)
}

function isOracleAgent(agentToUse: string): boolean {
  return agentToUse.toLowerCase() === "oracle"
}

function isUnexpectedEofError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  return lowered.includes("unexpected eof") || lowered.includes("json parse error")
}

export async function sendSyncPrompt(
  client: NativeClient,
  input: {
    sessionID: string
    agentToUse: string
    args: DelegateTaskArgs
    systemContent: string | undefined
    categoryModel: { providerID: string; modelID: string; variant?: string; temperature?: number } | undefined
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
  },
  deps: SendSyncPromptDeps = sendSyncPromptDeps
): Promise<string | null> {
  const allowTask = isPlanFamily(input.agentToUse)
  const tools = {
    task: allowTask,
    question: false,
    ...getAgentToolRestrictions(input.agentToUse),
  }
  setSessionTools(input.sessionID, tools)

  if (input.categoryModel?.temperature !== undefined) {
    setSessionTemperature(input.sessionID, input.categoryModel.temperature)
  }

  // Native v2 session.prompt takes a flat { sessionID, text } payload: per-message
  // agent/model/system/tools selection does not exist on this endpoint. Agent and
  // model are pinned at session.create; tools and temperature flow through the
  // local session-state stores consumed by hooks; per-task system instructions
  // are prepended to the user text so the child still receives them.
  const promptText =
    input.systemContent !== undefined && input.systemContent.length > 0
      ? `${input.systemContent}\n\n${input.args.prompt}`
      : input.args.prompt
  const promptArgs: SyncPromptV2Args = { sessionID: input.sessionID, text: promptText }

  const errorContext = {
    operation: "Send prompt",
    args: input.args,
    sessionID: input.sessionID,
    agent: input.agentToUse,
    category: input.args.category,
  }

  try {
    await deps.sendNativePrompt(client.session, promptArgs)
  } catch (promptError) {
    if (isOracleAgent(input.agentToUse) && isUnexpectedEofError(promptError)) {
      try {
        await deps.sendNativePrompt(client.session, promptArgs)
        return null
      } catch (oracleRetryError) {
        return formatDetailedError(oracleRetryError, errorContext)
      }
    }

    if (input.toastManager && input.taskId !== undefined) {
      input.toastManager.removeTask(input.taskId)
    }
    const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
    if (isAgentNotFoundError(errorMessage, input.agentToUse)) {
      return formatDetailedError(new Error(`Agent "${input.agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`), {
        operation: "Send prompt to agent",
        args: input.args,
        sessionID: input.sessionID,
        agent: input.agentToUse,
        category: input.args.category,
      })
    }
    return formatDetailedError(promptError, errorContext)
  }

  return null
}
