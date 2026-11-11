import { delay } from "../runtime/delay"
import { messagesOf } from "./session-context-source"
import { finishOf, isAssistant, type SessionMessage, textOf } from "./session-message"
import { setSessionTemperature } from "./session-state"

export interface NativeSubagentSessionDomain {
  create(body?: Record<string, unknown>): Promise<unknown>
  prompt(args: { sessionID: string } & Record<string, unknown>): Promise<unknown>
  interrupt(args: { sessionID: string }): Promise<unknown>
  context(args: { sessionID: string }): Promise<unknown>
}

export interface NativeSubagentClient {
  session: NativeSubagentSessionDomain
}

export interface NativeSubagentModel {
  providerID: string
  modelID: string
  temperature?: number
}

export interface SpawnNativeSubagentInput {
  agent: string
  prompt: string
  parentSessionID: string
  title: string
  model?: NativeSubagentModel
}

export type SpawnNativeSubagentResult =
  | { ok: true; sessionID: string }
  | { ok: false; error: string }

export type WaitNativeSubagentResult = {
  status: "completed" | "timeout" | "failed"
  output?: string
  error?: string
}

const NON_TERMINAL_FINISH = new Set(["tool-calls", "unknown"])

type SettleState = "running" | "completed" | "failed"

function settleStateOf(messages: SessionMessage[]): SettleState {
  let lastUserIndex = -1
  let lastAssistantIndex = -1
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.type === "user") lastUserIndex = index
    if (isAssistant(message)) lastAssistantIndex = index
  }
  if (lastAssistantIndex < 0 || lastUserIndex < 0 || lastAssistantIndex < lastUserIndex) {
    return "running"
  }
  const assistant = messages[lastAssistantIndex]
  const failure = asRecord(assistant)?.error
  if (failure !== undefined && failure !== null) return "failed"
  const finish = finishOf(assistant)
  if (finish === undefined) {
    const hostPublishesFinish = messages.some((message) => finishOf(message) !== undefined)
    if (hostPublishesFinish) return "running"
    return textOf(assistant).trim().length > 0 ? "completed" : "running"
  }
  if (NON_TERMINAL_FINISH.has(finish)) return "running"
  return "completed"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function errorMessageOf(error: unknown): string {
  const message = asRecord(error)?.message
  if (typeof message === "string" && message.length > 0) return message
  return error instanceof Error ? error.message : String(error)
}

function sessionIDOf(created: unknown): string | undefined {
  const id = asRecord(created)?.id
  return typeof id === "string" ? id : undefined
}

export async function spawnNativeSubagent(
  client: NativeSubagentClient,
  input: SpawnNativeSubagentInput,
): Promise<SpawnNativeSubagentResult> {
  let created: unknown
  try {
    created = await client.session.create({
      parentID: input.parentSessionID,
      title: input.title,
      agent: input.agent,
      ...(input.model
        ? {
            model: {
              id: input.model.modelID,
              providerID: input.model.providerID,
            },
          }
        : {}),
    })
  } catch (error) {
    return { ok: false, error: `Failed to create subagent session: ${errorMessageOf(error)}` }
  }
  const sessionID = sessionIDOf(created)
  if (!sessionID) return { ok: false, error: "Failed to create subagent session: missing session id" }

  if (input.model?.temperature !== undefined) {
    setSessionTemperature(sessionID, input.model.temperature)
  }

  try {
    await client.session.prompt({ sessionID, text: input.prompt })
  } catch (error) {
    return { ok: false, error: `Failed to prompt subagent session ${sessionID}: ${errorMessageOf(error)}` }
  }
  return { ok: true, sessionID }
}

export function readNativeSubagentOutput(messages: SessionMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!isAssistant(message)) continue
    const text = textOf(message).trim()
    if (text.length > 0) return text
  }
  return ""
}

async function fetchMessages(
  client: NativeSubagentClient,
  sessionID: string,
): Promise<SessionMessage[]> {
  return messagesOf(await client.session.context({ sessionID }))
}

export async function waitNativeSubagent(
  client: NativeSubagentClient,
  input: {
    sessionID: string
    timeoutMs: number
    pollIntervalMs?: number
    signal?: AbortSignal
  },
): Promise<WaitNativeSubagentResult> {
  const pollIntervalMs = input.pollIntervalMs ?? 1000
  const deadline = Date.now() + input.timeoutMs

  for (;;) {
    if (input.signal?.aborted) {
      await client.session.interrupt({ sessionID: input.sessionID }).catch(() => undefined)
      return { status: "failed", error: "interrupted" }
    }

    let messages: SessionMessage[]
    try {
      messages = await fetchMessages(client, input.sessionID)
    } catch (error) {
      return { status: "failed", error: errorMessageOf(error) }
    }

    const state = settleStateOf(messages)
    if (state === "completed") {
      return { status: "completed", output: readNativeSubagentOutput(messages) }
    }
    if (state === "failed") {
      const failure = asRecord(messages.filter((message) => isAssistant(message)).at(-1))?.error
      return { status: "failed", error: failure !== undefined && failure !== null ? String(failure) : "Unknown error" }
    }

    if (Date.now() >= deadline) {
      await client.session.interrupt({ sessionID: input.sessionID }).catch(() => undefined)
      return { status: "timeout" }
    }

    try {
      await delay(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)), input.signal)
    } catch {
      await client.session.interrupt({ sessionID: input.sessionID }).catch(() => undefined)
      return { status: "failed", error: "interrupted" }
    }
  }
}
