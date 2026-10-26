// docs-lookup-guard — warn-first docs-lookup nudge (only-operator-direct).
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import { getSessionAgent } from "../../features/session-state/state"
import { log } from "../../shared"
import { FALLBACK_MESSAGE, GUARDED_TOOLS, HOOK_NAME, NUDGE_MESSAGE, OPERATOR_AGENT } from "./constants"

function isOperatorAgent(agent: string | undefined): boolean {
  return agent?.toLowerCase().includes(OPERATOR_AGENT) ?? false
}

function looksEmptyOrFailed(output: string): boolean {
  const trimmed = output.trim()
  if (trimmed.length === 0) return true
  const lowered = trimmed.toLowerCase()
  return (
    lowered.includes("no results") ||
    lowered.includes("not found") ||
    lowered.includes("error") ||
    lowered.includes("failed")
  )
}

export function createDocsLookupGuardHook(ctx: PluginInput): Hooks {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string; agent?: string },
      output: { args: Record<string, unknown>; message?: string },
    ): Promise<void> => {
      const tool = input.tool?.toLowerCase()
      if (!tool || !GUARDED_TOOLS.has(tool)) return

      const currentAgent = getSessionAgent(input.sessionID) ?? input.agent
      if (isOperatorAgent(currentAgent)) return

      void ctx.directory
      log(`[${HOOK_NAME}] nudged direct docs lookup — delegate to operator`, {
        sessionID: input.sessionID,
        tool: input.tool,
      })
      output.message = NUDGE_MESSAGE
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; agent?: string },
      output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      const tool = input.tool?.toLowerCase()
      if (!tool || !GUARDED_TOOLS.has(tool)) return
      if (typeof output.output !== "string") return

      const currentAgent =
        getSessionAgent(input.sessionID) ?? (input as { agent?: string }).agent
      if (isOperatorAgent(currentAgent)) return

      // Warn-first fallback: never throw here. When a direct (non-operator)
      // docs call returns empty/failed output, append the operator-direct
      // routing fallback so the caller retries via the operator agent.
      if (!looksEmptyOrFailed(output.output)) return

      void ctx.directory
      log(`[${HOOK_NAME}] after-hook fallback — route docs lookup to operator`, {
        sessionID: input.sessionID,
        tool: input.tool,
      })
      output.output += `\n${FALLBACK_MESSAGE}`
    },
  }
}
