import { z } from "zod"

export const SubagentBlockConfigSchema = z.object({
  /** Enable the subagent-block hook (default: true). Disable via disabled_hooks or enabled:false. */
  enabled: z.boolean().default(true),
  /** Agent names exempt from blocking (allowlist, default: []). */
  allowlist: z.array(z.string()).default([]),
})

export type SubagentBlockConfig = z.infer<typeof SubagentBlockConfigSchema>
export type SubagentBlockConfigInput = z.input<typeof SubagentBlockConfigSchema>

/**
 * Resolve the effective config with built-in defaults.
 * Zod `.default()` only applies at parse time and `MatrixxConfig.subagent_block`
 * is optional, so call sites MUST resolve explicitly instead of reading raw fields.
 */
export function resolveSubagentBlock(
  input?: SubagentBlockConfigInput | null,
): SubagentBlockConfig {
  return SubagentBlockConfigSchema.parse(input ?? {})
}
