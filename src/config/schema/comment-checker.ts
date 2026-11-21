import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt that replaces the default in-process comment-scan warning. Use {{comments}} for the detected-comments XML. Scanning runs in-process via ast-grep; no external binary is needed. */
  custom_prompt: z.string().optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
