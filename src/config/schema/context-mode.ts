import { z } from "zod"
import { CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS } from "../../shared/context-mode-enforcement"

// "bash" is retained as a deprecated alias for V1 configs; "shell" is the V2 effective tool name.
const BlockedToolNameSchema = z.enum(["read", "grep", "glob", "bash", "shell", "webfetch"])

export const ContextModeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enforce: z.boolean().default(false),
  blocked_tools: z.array(BlockedToolNameSchema).default([...CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS]),
})

export type ContextModeConfig = z.infer<typeof ContextModeConfigSchema>
