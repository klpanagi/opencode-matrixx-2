import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { getErrorMessage } from "../../shared/error-formatting"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "../../shared/model-suggestion-retry"
import { isRecord } from "../../shared/record-type-guard"
import { setSessionTemperature, setSessionTools } from "../../shared/session-state"
import { isPlanFamily } from "./constants"
import { formatDetailedError } from "./error-formatting"
import type { DelegateTaskArgs, OpencodeClient } from "./types"

type SendSyncPromptDeps = {
  promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry
  promptSyncWithModelSuggestionRetry: typeof promptSyncWithModelSuggestionRetry
}

const sendSyncPromptDeps: SendSyncPromptDeps = {
  promptWithModelSuggestionRetry,
  promptSyncWithModelSuggestionRetry,
}

// Flat v2 session.prompt args served by host opencode v2.1.4: the session id
// travels top-level next to the body keys (no {path,body} wrapper). Sending
// the legacy wrapper yields 400 'Missing key [text]' on the host route.
export interface SyncPromptV2Args {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  system?: string
  tools?: Record<string, boolean>
  parts: Array<{ type: "text"; text: string }>
}

// Pinned-SDK bridge while shared/model-suggestion-retry.ts still types its
// args as the v1 {path,body} layout (updated by a parallel task). Remove the
// cast once that type accepts the flat v2 shape.
type PromptRetryArgs = Parameters<typeof promptWithModelSuggestionRetry>[1]

function toPromptRetryArgs(args: SyncPromptV2Args): PromptRetryArgs {
  return args as unknown as PromptRetryArgs
}

// Reads a resolved hey-api error envelope ({ error, response: { status } }).
// A resolved envelope means the prompt was rejected: surface it as an error,
// never let it pass silently into the poll phase.
export function promptEnvelopeErrorOf(settled: unknown): { status?: number; message: string } | null {
  if (!isRecord(settled) || !("error" in settled)) {
    return null
  }
  if (settled.error === undefined || settled.error === null) {
    return null
  }
  const response = settled.response
  const status = isRecord(response) && typeof response.status === "number" ? response.status : undefined
  return { status, message: getErrorMessage(settled.error) }
}

function envelopeToError(envelope: { status?: number; message: string }): Error {
  return new Error(
    envelope.status !== undefined
      ? `Prompt failed with status ${envelope.status}: ${envelope.message}`
      : `Prompt failed: ${envelope.message}`,
  )
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
  client: OpencodeClient,
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

  const promptArgs: SyncPromptV2Args = {
    sessionID: input.sessionID,
    agent: input.agentToUse,
    ...(input.systemContent !== undefined ? { system: input.systemContent } : {}),
    tools,
    parts: [{ type: "text", text: input.args.prompt }],
    ...(input.categoryModel
      ? { model: { providerID: input.categoryModel.providerID, modelID: input.categoryModel.modelID } }
      : {}),
    ...(input.categoryModel?.variant ? { variant: input.categoryModel.variant } : {}),
  }

  const errorContext = {
    operation: "Send prompt",
    args: input.args,
    sessionID: input.sessionID,
    agent: input.agentToUse,
    category: input.args.category,
  }

  try {
    const settled: unknown = await deps.promptWithModelSuggestionRetry(client, toPromptRetryArgs(promptArgs))
    const envelopeError = promptEnvelopeErrorOf(settled)
    if (envelopeError !== null) {
      if (input.toastManager && input.taskId !== undefined) {
        input.toastManager.removeTask(input.taskId)
      }
      return formatDetailedError(envelopeToError(envelopeError), errorContext)
    }
  } catch (promptError) {
    let lastError = promptError
    if (isOracleAgent(input.agentToUse) && isUnexpectedEofError(promptError)) {
      try {
        const syncSettled: unknown = await deps.promptSyncWithModelSuggestionRetry(
          client,
          toPromptRetryArgs(promptArgs)
        )
        const syncEnvelopeError = promptEnvelopeErrorOf(syncSettled)
        if (syncEnvelopeError === null) {
          return null
        }
        lastError = envelopeToError(syncEnvelopeError)
      } catch (oracleRetryError) {
        lastError = oracleRetryError
      }
    }

    if (input.toastManager && input.taskId !== undefined) {
      input.toastManager.removeTask(input.taskId)
    }
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return formatDetailedError(new Error(`Agent "${input.agentToUse}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`), {
        operation: "Send prompt to agent",
        args: input.args,
        sessionID: input.sessionID,
        agent: input.agentToUse,
        category: input.args.category,
      })
    }
    return formatDetailedError(lastError, errorContext)
  }

  return null
}
