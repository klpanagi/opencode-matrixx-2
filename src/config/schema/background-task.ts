import { z } from "zod"

const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().optional().describe("deprecated: ignored; the background circuit breaker was removed."),
  maxToolCalls: z.number().int().min(10).optional().describe("deprecated: ignored; the background circuit breaker was removed."),
  consecutiveThreshold: z.number().int().min(5).optional().describe("deprecated: ignored; the background circuit breaker was removed."),
})

/** Idle-parent wake scheduler settings (removed; accepted for config compatibility) */
export const WakeSchedulerConfigSchema = z.object({
  enabled: z.boolean().optional().describe("deprecated: ignored since the wake scheduler was removed."),
  intervalMs: z.number().min(60000).optional().describe("deprecated: ignored since the wake scheduler was removed."),
})

/** Job-board snapshot settings (removed; accepted for config compatibility) */
export const JobBoardConfigSchema = z.object({
  enabled: z.boolean().optional().describe("deprecated: ignored since the job board was removed."),
  strategy: z.enum(["latest", "checkpoint-compatible"]).optional().describe("deprecated: ignored since the job board was removed."),
  maxRetainedSnapshots: z.number().int().min(1).max(100).optional().describe("deprecated: ignored since the job board was removed."),
})

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional().describe("deprecated: ignored; queue admission and concurrency semaphores were removed."),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional().describe("deprecated: ignored; concurrency semaphores were removed."),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional().describe("deprecated: ignored; concurrency semaphores were removed."),
  staleTimeoutMs: z.number().min(60000).optional().describe("deprecated: ignored; stale-timeout termination is no longer configurable."),
  messageStalenessTimeoutMs: z.number().min(60000).optional().describe("deprecated: ignored; message-staleness termination is no longer configurable."),
  /** Handle retention window in ms (default: 1800000 = 30 min, minimum: 60000 = 1 min). Controls how long persisted `.matrixx/bg-handles/*.json` survive for `background_revive`, and how long terminal tasks + completion notifications are retained in memory. */
  handleTtlMs: z.number().int().min(60000).max(2147483647).optional(),
  maxToolCalls: z.number().int().min(10).optional().describe("deprecated: ignored; the background circuit breaker was removed."),
  circuitBreaker: CircuitBreakerConfigSchema.optional().describe("deprecated: ignored; the background circuit breaker was removed."),
  wakeScheduler: WakeSchedulerConfigSchema.optional().describe("deprecated: ignored since the wake scheduler was removed."),
  jobBoard: JobBoardConfigSchema.optional().describe("deprecated: ignored since the job board was removed."),
  /** Elapsed-time bound in ms. 0 = OFF (default); otherwise minimum 60000, max 2^31-1 (setTimeout ceiling). */
  wallClockTimeoutMs: z.union([z.literal(0), z.number().int().min(60000).max(2147483647)]).optional(),
  wallClockAbortGraceMs: z.number().int().min(1000).max(60000).optional().describe("deprecated: ignored; wall-clock timeout aborts immediately without a grace period."),
  /**
   * Reuse an active pending/running task with the same parent session and
   * delegation key instead of launching a duplicate. Default false (opt-in).
   */
  dedupeActiveDelegations: z.boolean().optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
