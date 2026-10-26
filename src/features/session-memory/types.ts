import { z } from "zod"
import { DEFAULT_PINNED, DEFAULT_REMOVED, DEFAULT_SCOPE } from "./constants"

export const MemoryScopeSchema = z.enum(["session", "project", "global"])
export type MemoryScope = z.infer<typeof MemoryScopeSchema>

export const MemoryEntrySchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    messageId: z.string(),
    scope: MemoryScopeSchema.default(DEFAULT_SCOPE),
    text: z.string(),
    chars: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    pinned: z.boolean().default(DEFAULT_PINNED),
    removed: z.boolean().default(DEFAULT_REMOVED),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict()

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export const MemoryEntryInputSchema = MemoryEntrySchema.omit({
  chars: true,
  tokens: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    chars: z.number().int().nonnegative().optional(),
    tokens: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().optional(),
    updatedAt: z.number().int().optional(),
  })
  .strict()

export type MemoryEntryInput = z.infer<typeof MemoryEntryInputSchema>
