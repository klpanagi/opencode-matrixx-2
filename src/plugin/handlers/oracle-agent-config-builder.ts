import { createOracleSystemPrompt, ORACLE_PERMISSION } from "../../agents/definitions/oracle"
import { mergeAgentConfig } from "../../agents/registry/agent-overrides"
import { ORCHESTRATOR_STATIC_SKILLS, prependStaticSkillTemplates } from "../../agents/shared/agent-builder"
import { type AgentConfig, parseModelRef } from "../../agents/shared/agent-config"
import type { AgentOverrideConfig } from "../../agents/shared/types"
import type { BrowserAutomationProvider, CategoryConfig, ModelRequirements } from "../../config/schema"
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from "../../shared"
import { getAgentModelRequirements } from "../../shared/model/model-requirements"
import { resolveCategoryConfig } from "./category-config-resolver"

export async function buildOracleAgentConfig(params: {
  configAgentPlan: Record<string, unknown> | undefined
  pluginOracleOverride: AgentOverrideConfig | undefined
  userCategories: Record<string, CategoryConfig> | undefined
  currentModel: string | undefined
  globalOverrideModel?: string
  modelRequirements?: ModelRequirements
  pluginConfig?: { plans?: { smith_max_review_rounds?: number } }
  directory?: string
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}): Promise<AgentConfig> {
  const categoryConfig = params.pluginOracleOverride?.category
    ? resolveCategoryConfig(params.pluginOracleOverride.category, params.userCategories)
    : undefined

  const agentRequirements = getAgentModelRequirements(params.modelRequirements ? { modelRequirements: params.modelRequirements } : undefined)
  const requirement = agentRequirements.oracle
  const connectedProviders = readConnectedProvidersCache()
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  })

  const modelResolution = resolveModelPipeline({
    intent: {
      globalOverrideModel: params.globalOverrideModel,
      uiSelectedModel: params.currentModel,
      userModel: params.pluginOracleOverride?.model ?? categoryConfig?.model,
    },
    constraints: { availableModels },
    policy: {
      fallbackChain: requirement?.fallbackChain,
      systemDefaultModel: undefined,
    },
  })

  const resolvedModel = modelResolution?.model
  const variantToUse = params.pluginOracleOverride?.variant ?? modelResolution?.variant
  const parsedModel = resolvedModel ? parseModelRef(resolvedModel) : undefined
  const model = parsedModel && variantToUse ? { ...parsedModel, variant: variantToUse } : parsedModel

  const request = categoryConfig?.request
    ? { ...categoryConfig.request, body: { ...categoryConfig.request.body } }
    : undefined

  const base: AgentConfig = {
    ...(model ? { model } : {}),
    ...(request ? { request } : {}),
    mode: "all",
    system: createOracleSystemPrompt(params.pluginConfig),
    permissions: ORACLE_PERMISSION,
    description: `${(params.configAgentPlan?.description as string) ?? "Plan agent"} (Oracle - Matrixx)`,
    color: (params.configAgentPlan?.color as string) ?? "#FF5722",
  }

  const withStaticSkills = prependStaticSkillTemplates(base, ORCHESTRATOR_STATIC_SKILLS, {
    browserProvider: params.browserProvider,
    disabledSkills: params.disabledSkills,
  })

  if (!params.pluginOracleOverride) return withStaticSkills

  return mergeAgentConfig(withStaticSkills, params.pluginOracleOverride, params.directory)
}
