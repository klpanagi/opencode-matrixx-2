import { z } from "zod"
import { PermissionRuleSchema } from "./internal/permission"
import { AgentRequestSchema } from "./internal/request"

export const CategoryConfigSchema = z.object({
  /** Human-readable description of the category's purpose. Shown in task prompt. */
  description: z.string().optional(),
  model: z.string().optional(),
  variant: z.string().optional(),
  request: AgentRequestSchema.optional(),
  system: z.string().optional(),
  /** Text to append to the category system prompt. Supports file:// URIs (file:///abs, file://./rel, file://~/home) */
  system_append: z.string().optional(),
  disabled: z.boolean().optional(),
  steps: z.number().int().positive().optional(),
  permissions: z.array(PermissionRuleSchema).optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini/minimax models. */
  is_unstable_agent: z.boolean().optional(),
  /** Ordered list of fallback models to try when the primary model fails (e.g. rate limit, quota) */
  fallback_models: z.union([z.string(), z.array(z.string())]).optional(),
  /** Per-complexity-level model downgrades. Key is complexity level string ("1"-"5"), value is model string. */
  complexity_downgrades: z.record(z.string(), z.string()).optional(),
})

export const BuiltinCategoryNameSchema = z.enum([
  "construct",
  "source",
  "deep-jack",
  "matrix-bend",
  "bullet-time",
  "blue-pill",
  "red-pill",
  "broadcast",
])

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
