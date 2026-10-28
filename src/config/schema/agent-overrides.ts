import { z } from "zod"
import { PermissionRuleSchema } from "./internal/permission"
import { AgentRequestSchema } from "./internal/request"

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
  model: z.string().optional(),
  variant: z.string().optional(),
  /** Category name to inherit model and other settings from CategoryConfig */
  category: z.string().optional(),
  /** Skill names to inject into agent prompt */
  skills: z.array(z.string()).optional(),
  request: AgentRequestSchema.optional(),
  system: z.string().optional(),
  /** Text to append to the agent system prompt. Supports file:// URIs (file:///abs, file://./rel, file://~/home) */
  system_append: z.string().optional(),
  disabled: z.boolean().optional(),
  steps: z.number().int().positive().optional(),
  permissions: z.array(PermissionRuleSchema).optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  /** Custom fallback chain. Overrides the default fallback chain for this agent. */
  fallbackChain: z.array(
    z.object({
      providers: z.array(z.string()),
      model: z.string(),
      variant: z.string().optional(),
    })
  ).optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  morpheus: AgentOverrideConfigSchema.optional(),
  keymaker: AgentOverrideConfigSchema.optional(),
  mouse: AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  seraph: AgentOverrideConfigSchema.optional(),
  smith: AgentOverrideConfigSchema.optional(),
  merovingian: AgentOverrideConfigSchema.optional(),
  operator: AgentOverrideConfigSchema.optional(),
  trinity: AgentOverrideConfigSchema.optional(),
  construct: AgentOverrideConfigSchema.optional(),
  niobe: AgentOverrideConfigSchema.optional(),
  cipher: AgentOverrideConfigSchema.optional(),
  sentinel: AgentOverrideConfigSchema.optional(),
  sati: AgentOverrideConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
