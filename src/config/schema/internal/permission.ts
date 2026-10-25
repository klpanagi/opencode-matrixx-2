import { z } from "zod"

export const PermissionRuleSchema = z.object({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(["allow", "deny", "ask"]),
})

export type PermissionRule = z.infer<typeof PermissionRuleSchema>
