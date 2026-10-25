import { z } from "zod"

export const AgentRequestSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
})

export type AgentRequest = z.infer<typeof AgentRequestSchema>
