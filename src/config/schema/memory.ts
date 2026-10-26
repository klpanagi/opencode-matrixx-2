import { z } from "zod"

/**
 * Session-memory (opencode-lcm interop) configuration.
 *
 * Plugin-only OpenCode config — opt-in via `enabled: true` (default: false).
 * Defaults mirror upstream opencode-lcm `DEFAULT_OPTIONS` at pinned SHA
 * `84103cca85b2324626a8b8df0f592a555fe8ac96` (v0.15.1).
 * `retention.staleSessionDays` undefined = disabled (NOT 90).
 */
const ScopeNameSchema = z.enum(["session", "root", "worktree", "all"])

export const ScopeDefaultsSchema = z.object({
  grep: ScopeNameSchema.default("session"),
  describe: ScopeNameSchema.default("session"),
})

export const ScopeProfileSchema = z.object({
  worktree: z.string(),
  grep: ScopeNameSchema.optional(),
  describe: ScopeNameSchema.optional(),
})

export const RetentionPolicySchema = z.object({
  staleSessionDays: z.number().optional(),
  deletedSessionDays: z.number().optional().default(30),
  orphanBlobDays: z.number().optional().default(14),
})

export const AutomaticRetrievalBudgetsSchema = z.object({
  session: z.number().default(16),
  root: z.number().default(12),
  worktree: z.number().default(8),
  all: z.number().default(6),
})

const DEFAULT_AUTOMATIC_RETRIEVAL_BUDGETS = {
  session: 16,
  root: 12,
  worktree: 8,
  all: 6,
} as const

const DEFAULT_AUTOMATIC_RETRIEVAL = {
  maxChars: 900,
  minTokens: 2,
  maxMessageHits: 2,
  maxSummaryHits: 1,
  maxArtifactHits: 1,
  budgets: { ...DEFAULT_AUTOMATIC_RETRIEVAL_BUDGETS },
} as const

export const AutomaticRetrievalSchema = z.object({
  maxChars: z.number().default(DEFAULT_AUTOMATIC_RETRIEVAL.maxChars),
  minTokens: z.number().default(DEFAULT_AUTOMATIC_RETRIEVAL.minTokens),
  maxMessageHits: z.number().default(DEFAULT_AUTOMATIC_RETRIEVAL.maxMessageHits),
  maxSummaryHits: z.number().default(DEFAULT_AUTOMATIC_RETRIEVAL.maxSummaryHits),
  maxArtifactHits: z.number().default(DEFAULT_AUTOMATIC_RETRIEVAL.maxArtifactHits),
  budgets: AutomaticRetrievalBudgetsSchema.default({
    ...DEFAULT_AUTOMATIC_RETRIEVAL_BUDGETS,
  }),
})

export const MemoryConfigSchema = z.object({
  /** Enable session-memory interop (default: false — opt-in) */
  enabled: z.boolean().default(false),
  /** Tool-name prefixes ignored when guessing message text (upstream: ["ctx_"]) */
  ignoreToolPrefixes: z.array(z.string()).default(["ctx_"]),
  scopeDefaults: ScopeDefaultsSchema.default({ grep: "session", describe: "session" }),
  scopeProfiles: z.array(ScopeProfileSchema).default([]),
  retention: RetentionPolicySchema.default({
    deletedSessionDays: 30,
    orphanBlobDays: 14,
  }),
  /** Deterministic summary per-message char budget (upstream DEFAULT_SUMMARY_V2) */
  perMessageBudget: z.number().default(110),
  automaticRetrieval: AutomaticRetrievalSchema.default({
    ...DEFAULT_AUTOMATIC_RETRIEVAL,
    budgets: { ...DEFAULT_AUTOMATIC_RETRIEVAL.budgets },
  }),
  compactContextLimit: z.number().default(1200),
  systemHint: z.boolean().default(true),
})

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>
