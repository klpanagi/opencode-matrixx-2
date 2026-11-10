import { z } from "zod"
import { AgentOverridesSchema } from "./agent-overrides"
import { CategoriesConfigSchema } from "./categories"

export const AgentsFilePointerSchema = z.string().min(1)

export type AgentsFilePointer = z.infer<typeof AgentsFilePointerSchema>

export const AgentsFileSchema = z.object({
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
})

export type AgentsFileContent = z.infer<typeof AgentsFileSchema>
