import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { LlmUsage } from "../../features/evolution/compressor/interface"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, isAssistant, timeOf } from "../../shared/session-message"
import { withEphemeralSession } from "../../shared/with-ephemeral-session"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

type Client = ReturnType<typeof createOpencodeClient>

function latestAssistantText(messages: unknown): string | null {
  const list = normalizeSDKResponse<SessionMessage[]>(messages, [])
  if (!Array.isArray(list) || list.length === 0) return null
  const assistants = list.filter((m) => isAssistant(m))
  assistants.sort((a, b) => timeOf(b) - timeOf(a))
  const latest = assistants[0]
  if (!latest) return null
  const text = contentOf(latest)
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
  return text.length > 0 ? text : null
}

export function parseModelOverride(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined
  return parseModelString(model)
}

export function createHostLlmCall(options: {
  client: Client
  directory: string
  agent?: string
  model?: string
  parentID?: string
}): (prompt: string, model?: string) => Promise<{ text: string; usage?: LlmUsage }> {
  const { client, directory, agent, model: defaultModel, parentID } = options
  return async (prompt: string, model?: string) => {
    const effectiveModel = model ?? defaultModel
    const parsed = parseModelOverride(effectiveModel)
    return withEphemeralSession({
      client,
      directory,
      title: "evolution-compressor",
      ...(parentID ? { parentID } : {}),
      body: async (sessionID: string) => {
        try {
          await client.session.prompt({
            path: { id: sessionID },
            body: {
              ...(agent ? { agent } : {}),
              ...(parsed ? { model: parsed } : {}),
              parts: [{ type: "text", text: prompt }],
            },
            query: { directory },
          })
        } catch (error) {
          log("[evolution-compressor] host prompt failed", { error: String(error) })
          throw error instanceof Error ? error : new Error(String(error))
        }
        const messages = await client.session.messages({ path: { id: sessionID } })
        const text = latestAssistantText(messages)
        if (!text) throw new Error("evolution-compressor: host returned no assistant text")
        return { text }
      },
    })
  }
}
