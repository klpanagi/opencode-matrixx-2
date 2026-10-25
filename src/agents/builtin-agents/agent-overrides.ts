import type { CategoryConfig } from "../../config/schema"
import { type AgentConfig, parseModelRef } from "../agent-config"
import type { AgentOverrideConfig } from "../types"
import { resolvePromptAppend } from "./resolve-file-uri"

/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
export function applyCategoryOverride(
  config: AgentConfig,
  categoryName: string,
  mergedCategories: Record<string, CategoryConfig>
): AgentConfig {
  const categoryConfig = mergedCategories[categoryName]
  if (!categoryConfig) return config

  const result: AgentConfig = { ...config }
  if (categoryConfig.model) result.model = parseModelRef(categoryConfig.model)
  if (result.model && categoryConfig.variant !== undefined) {
    result.model = { ...result.model, variant: categoryConfig.variant }
  }
  if (categoryConfig.request) {
    result.request = {
      ...result.request,
      ...categoryConfig.request,
      body: { ...result.request?.body, ...categoryConfig.request.body },
    }
  }

  if (categoryConfig.system_append) {
    const appended = resolvePromptAppend(categoryConfig.system_append)
    result.system = result.system ? `${result.system}\n${appended}` : appended
  }

  return result
}

export function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig,
  directory?: string
): AgentConfig {
  const { system_append, model, variant, request: overrideRequest, ...rest } = override
  const merged: AgentConfig = { ...base, ...rest }

  if (model !== undefined) {
    merged.model = parseModelRef(model)
  }
  if (merged.model && variant !== undefined) {
    merged.model = { ...merged.model, variant }
  }

  if (overrideRequest) {
    merged.request = {
      ...base.request,
      ...overrideRequest,
      body: { ...base.request?.body, ...overrideRequest.body },
    }
  }

  if (system_append) {
    const appended = resolvePromptAppend(system_append, directory)
    merged.system = merged.system ? `${merged.system}\n${appended}` : appended
  }

  return merged
}

export function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>,
  directory?: string
): AgentConfig {
  let result = config
  const overrideCategory = override?.category
  if (overrideCategory) {
    result = applyCategoryOverride(result, overrideCategory, mergedCategories)
  }

  if (override) {
    result = mergeAgentConfig(result, override, directory)
  }

  return result
}
