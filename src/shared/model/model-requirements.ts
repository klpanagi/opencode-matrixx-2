import {
  AgentModelRequirementsSchema,
  CategoryModelRequirementsSchema,
  type ModelRequirements,
} from "../../config/schema/model-config"

export type FallbackEntry = {
  providers: string[]
  model: string
  variant?: string
}

export type ModelRequirement = {
  fallbackChain: FallbackEntry[]
  variant?: string
  requiresModel?: string
  requiresAnyModel?: boolean
  requiresProvider?: string[]
}

export const DEFAULT_AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  morpheus: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
    requiresAnyModel: true,
  },
  keymaker: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  merovingian: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  operator: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  trinity: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  construct: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  oracle: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  seraph: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  smith: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  niobe: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
    ],
  },
  cipher: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  sentinel: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  sati: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  // Per-category worker subagents (native migration): each mirrors the chain of
  // its delegate-task category from DEFAULT_CATEGORY_MODEL_REQUIREMENTS so the
  // registry model-resolution gate does not drop them pre-factory.
  "mouse-construct": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-source": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-rabbit-hole": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-glitch": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-bullet-time": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-blue-pill": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-the-one": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "mouse-transmission": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
    ],
  },
}

export const DEFAULT_CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  construct: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  source: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "rabbit-hole": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "glitch": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
    ],
  },
  "bullet-time": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  "blue-pill": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
    ],
  },
  "the-one": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
    ],
  },
  transmission: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" }, // allow-hardcoded: first-run fallback
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" }, // allow-hardcoded: first-run fallback
    ],
  },
}

// Backward compatibility aliases — existing imports use AGENT_MODEL_REQUIREMENTS
export const AGENT_MODEL_REQUIREMENTS = DEFAULT_AGENT_MODEL_REQUIREMENTS
export const CATEGORY_MODEL_REQUIREMENTS = DEFAULT_CATEGORY_MODEL_REQUIREMENTS

export function getAgentModelRequirements(
  config?: { modelRequirements?: ModelRequirements } | null,
): Record<string, ModelRequirement> {
  if (!config?.modelRequirements) return DEFAULT_AGENT_MODEL_REQUIREMENTS
  const agents = config.modelRequirements.agents
  if (!agents || Object.keys(agents).length === 0) return {}
  const result: Record<string, ModelRequirement> = {}
  for (const [key, value] of Object.entries(agents)) {
    const parsed = AgentModelRequirementsSchema.safeParse(value)
    if (parsed.success) {
      result[key] = parsed.data
    }
  }
  return result
}

export function getCategoryModelRequirements(
  config?: { modelRequirements?: ModelRequirements } | null,
): Record<string, ModelRequirement> {
  if (!config?.modelRequirements) return DEFAULT_CATEGORY_MODEL_REQUIREMENTS
  const categories = config.modelRequirements.categories
  if (!categories || Object.keys(categories).length === 0) return {}
  const result: Record<string, ModelRequirement> = {}
  for (const [key, value] of Object.entries(categories)) {
    const parsed = CategoryModelRequirementsSchema.safeParse(value)
    if (parsed.success) {
      result[key] = parsed.data
    }
  }
  return result
}
