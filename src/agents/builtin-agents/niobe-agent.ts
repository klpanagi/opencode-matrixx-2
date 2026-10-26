import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import { getAgentModelRequirements } from "../../shared/model-requirements"
import type { AgentConfig } from "../agent-config"
import { createNiobeAgent } from "../niobe"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import type { AgentOverrides } from "../types"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution } from "./model-resolution"

export function maybeCreateNiobeConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  globalOverrideModel?: string
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    globalOverrideModel,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories,
  } = input


  if (disabledAgents.includes("niobe")) return undefined

  const orchestratorOverride = agentOverrides.niobe
  const agentRequirements = getAgentModelRequirements()
  const niobeRequirement = agentRequirements.niobe

  const niobeResolution = applyModelResolution({
    globalOverrideModel,
    uiSelectedModel: orchestratorOverride?.model ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    requirement: niobeRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!niobeResolution) return undefined
  const { model: niobeModel, variant: niobeResolvedVariant } = niobeResolution

  let orchestratorConfig = createNiobeAgent({
    model: niobeModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (niobeResolvedVariant && orchestratorConfig.model) {
    orchestratorConfig = {
      ...orchestratorConfig,
      model: { ...orchestratorConfig.model, variant: niobeResolvedVariant },
    }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories, directory)

  return orchestratorConfig
}
