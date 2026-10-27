import type { BrowserAutomationProvider, CategoriesConfig, CategoryConfig } from "../config/schema"
import { mergeCategories } from "../shared/merge-categories"
import { createBuiltinSkills } from "../skills"
import { type AgentConfig, parseModelRef } from "./agent-config"
import type { AgentFactory } from "./types"

export type AgentSource = AgentFactory | AgentConfig

/**
 * Static skill list for the orchestrator session agents
 * (morpheus/keymaker/niobe/oracle). Consumed by the orchestrator
 * construction sites via prependStaticSkillTemplates() — the same
 * agent-builder skills mechanic, factored for call sites that bypass
 * buildAgent (dynamic-prompt factories + oracle builder).
 * NEVER add entries consumed by Mouse (BLOCKED subagent — the full
 * template is orchestrator-only per spec section 5.1).
 */
export const ORCHESTRATOR_STATIC_SKILLS = ["software-dev"] as const

export interface StaticSkillInjectionOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}

/**
 * Prepend resolved skill templates to a built agent config's system prompt.
 * Same mechanic as the buildAgent skills branch: names resolve through
 * createBuiltinSkills (disabledSkills filtered AFTER construction in
 * skills.ts), unknown/disabled names resolve to nothing, and an empty
 * resolution leaves the config untouched.
 */
export function prependStaticSkillTemplates(
  config: AgentConfig,
  skillNames: readonly string[],
  options: StaticSkillInjectionOptions = {}
): AgentConfig {
  if (skillNames.length === 0) return config
  const builtinSkills = createBuiltinSkills({
    browserProvider: options.browserProvider,
    disabledSkills: options.disabledSkills,
  })
  const resolved = builtinSkills.filter((s) => skillNames.includes(s.name))
  if (resolved.length === 0) return config
  const skillContent = resolved.map((s) => s.template).join("\n\n")
  return {
    ...config,
    system: skillContent + (config.system ? `\n\n${config.system}` : ""),
  }
}

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
    return prependStaticSkillTemplates(base, agentWithCategory.skills, { browserProvider, disabledSkills })
  }

  return base
}
