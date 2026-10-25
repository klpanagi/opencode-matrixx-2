import type { BrowserAutomationProvider, CategoriesConfig, CategoryConfig } from "../config/schema"
import { createBuiltinSkills } from "../skills"
import { mergeCategories } from "../shared/merge-categories"
import { type AgentConfig, parseModelRef } from "./agent-config"
import type { AgentFactory } from "./types"

export type AgentSource = AgentFactory | AgentConfig

export function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(
  source: AgentSource,
  model: string,
  categories?: CategoriesConfig,
  browserProvider?: BrowserAutomationProvider,
  disabledSkills?: Set<string>
): AgentConfig {
  const base = isFactory(source) ? source(model) : { ...source }
  // V2 agents carry ModelRef objects; normalize legacy "provider/id" strings
  // so category variant/request merging below operates on the object form.
  if (typeof base.model === "string") {
    base.model = parseModelRef(base.model)
  }
  const categoryConfigs: Record<string, CategoryConfig> = mergeCategories(categories)

  const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[] }
  if (agentWithCategory.category) {
    const categoryConfig = categoryConfigs[agentWithCategory.category]
    if (categoryConfig) {
      if (!base.model && categoryConfig.model) {
        base.model = parseModelRef(categoryConfig.model)
      }
      if (base.model && base.model.variant === undefined && categoryConfig.variant !== undefined) {
        base.model = { ...base.model, variant: categoryConfig.variant }
      }
      if (categoryConfig.request) {
        base.request = {
          ...categoryConfig.request,
          ...base.request,
          body: { ...categoryConfig.request.body, ...base.request?.body },
        }
      }
    }
  }

  if (agentWithCategory.skills?.length) {
    const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills })
    const resolved = builtinSkills.filter(s => agentWithCategory.skills?.includes(s.name))
    if (resolved.length > 0) {
      const skillContent = resolved.map(s => s.template).join("\n\n")
      base.system = skillContent + (base.system ? `\n\n${base.system}` : "")
    }
  }

  return base
}
