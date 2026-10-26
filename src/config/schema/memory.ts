import { z } from "zod"

/**
 * Session-memory (opencode-lcm interop) configuration.
 *
 * Backend selector: `memory.backend` (`off`|`native`|`lcm`|`supermemory`,
 * default `off`). Native keys live under `memory.native`. Flat
 * `memory.enabled: true` is honored as a deprecated alias for the native
 * backend (logs a one-time deprecation warning at the call site).
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

export const MemoryBackendSchema = z.enum(["off", "native", "lcm", "supermemory"])

export type MemoryBackend = z.infer<typeof MemoryBackendSchema>

export const NativeMemoryConfigSchema = z.object({
  /** Enable native session-memory interop (default: false — opt-in) */
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

export type NativeMemoryConfig = z.infer<typeof NativeMemoryConfigSchema>

const DEFAULT_NATIVE_MEMORY: NativeMemoryConfig = {
  enabled: false,
  ignoreToolPrefixes: ["ctx_"],
  scopeDefaults: { grep: "session", describe: "session" },
  scopeProfiles: [],
  retention: { deletedSessionDays: 30, orphanBlobDays: 14 },
  perMessageBudget: 110,
  automaticRetrieval: {
    maxChars: 900,
    minTokens: 2,
    maxMessageHits: 2,
    maxSummaryHits: 1,
    maxArtifactHits: 1,
    budgets: { session: 16, root: 12, worktree: 8, all: 6 },
  },
  compactContextLimit: 1200,
  systemHint: true,
}

export const MemoryConfigSchema = z.object({
  /** Backend selector (default: "off" — nothing runs) */
  backend: MemoryBackendSchema.default("off"),
  /** Native backend options */
  native: NativeMemoryConfigSchema.default(DEFAULT_NATIVE_MEMORY),
  /**
   * @deprecated flat alias — use `backend: "native"` + `native.enabled: true`.
   * `enabled: true` (without an explicit non-off backend) resolves to the
   * native backend with a one-time deprecation warning at the call site.
   */
  enabled: z.boolean().optional(),
})

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>

/**
 * Resolve the effective memory backend from parsed config.
 * Pure — no logging (callers emit the flat-alias deprecation warning once).
 *
 * Precedence: explicit non-off `backend` wins (even if `native.enabled`
 * disagrees); else flat `enabled === true` -> native (deprecated alias);
 * else `native.enabled === true` -> native; else off.
 */
export function resolveMemoryBackend(
  cfg?: Pick<MemoryConfig, "backend" | "native"> & { enabled?: boolean } | null,
): MemoryBackend {
  if (!cfg) return "off"
  const backend = (cfg as { backend?: MemoryBackend }).backend
  if (backend && backend !== "off") return backend
  if ((cfg as { enabled?: boolean }).enabled === true) return "native"
  if ((cfg as { native?: { enabled?: boolean } }).native?.enabled === true) return "native"
  return "off"
}
