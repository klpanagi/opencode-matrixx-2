import type { LlmUsage } from "../../features/evolution/compressor/interface"
import { log } from "../../shared/logger"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import type { SessionMessage } from "../../shared/session-message"
import { contentOf, isAssistant, timeOf } from "../../shared/session-message"
import { type EphemeralSessionHandle, withEphemeralSession } from "../../shared/with-ephemeral-session"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

function latestAssistantText(messages: SessionMessage[]): string | null {
  if (messages.length === 0) return null
  const assistants = messages.filter((m) => isAssistant(m))
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
  ctx: NativePluginContext
  agent?: string
  model?: string
  parentID?: string
}): (prompt: string, model?: string) => Promise<{ text: string; usage?: LlmUsage }> {
  const { ctx, agent, model: defaultModel, parentID } = options
  return async (prompt: string, model?: string) => {
    const effectiveModel = model ?? defaultModel
    const parsed = parseModelOverride(effectiveModel)
    return withEphemeralSession({
      session: ctx.session as unknown as EphemeralSessionHandle,
      title: "evolution-compressor",
      ...(parentID ? { parentID } : {}),
      body: async (sessionID: string) => {
        try {
          await ctx.session.prompt({
            sessionID,
            ...(agent ? { agent } : {}),
            ...(parsed ? { model: parsed } : {}),
            parts: [{ type: "text", text: prompt }],
          })
        } catch (error) {
          log("[evolution-compressor] host prompt failed", { error: String(error) })
          throw error instanceof Error ? error : new Error(String(error))
        }
        const text = latestAssistantText(await fetchSessionMessages(ctx, sessionID))
        if (!text) throw new Error("evolution-compressor: host returned no assistant text")
        return { text }
      },
    })
  }
}
