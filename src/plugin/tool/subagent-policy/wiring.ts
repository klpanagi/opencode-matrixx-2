import { applyModelResolution } from "../../../agents/registry/model-resolution"
import type { MatrixxConfig } from "../../../config"
import { getAgentModelRequirements } from "../../../shared/model/model-requirements"
import type { SubagentPolicyDeps } from "./index"

function defaultModelForAgent(pluginConfig: MatrixxConfig, agentId: string): string | undefined {
  const userModel = (pluginConfig.agents as Record<string, { model?: string } | undefined> | undefined)?.[agentId]?.model
  const requirement = getAgentModelRequirements(
    pluginConfig.modelRequirements ? { modelRequirements: pluginConfig.modelRequirements } : undefined,
  )[agentId]
  const resolution = applyModelResolution({
    globalOverrideModel: pluginConfig.global_model,
    uiSelectedModel: undefined,
    userModel,
    requirement,
    availableModels: new Set<string>(),
    systemDefaultModel: undefined,
  })
  // No blind chain[0] fallback here: injecting an unconfirmed model as an EXPLICIT
  // subagent input.model makes the native spawn hard-fail ("Model unavailable") in
  // environments where the hardcoded chains are not servable. Omitting the model
  // instead lets opencode fall back to the agent/session default (legacy spawn
  // behavior — model was optional in createSyncSession).
  return resolution?.model
}

export function buildSubagentPolicyDeps(pluginConfig: MatrixxConfig): SubagentPolicyDeps {
  const userDowngrades: Record<string, Record<string, string>> = {}
  for (const [category, entry] of Object.entries(pluginConfig.categories ?? {})) {
    if (entry?.complexity_downgrades) {
      userDowngrades[category] = entry.complexity_downgrades
    }
  }
  return {
    complexity: {
      downgrades: pluginConfig.complexityDowngrades,
      userDowngrades,
      defaultModelFor: (agentId: string) => defaultModelForAgent(pluginConfig, agentId),
    },
  }
}
