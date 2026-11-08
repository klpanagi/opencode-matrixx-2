import { z } from "zod"

export const EffortWeightsSchema = z.object({
  compute: z.number().finite().min(0).default(0.5),
  action: z.number().finite().min(0).default(0.25),
  epistemic: z.number().finite().min(0).default(0.15),
  coord: z.number().finite().min(0).default(0.1),
})
export type EffortWeights = z.infer<typeof EffortWeightsSchema>

export const EffortPricesSchema = z.object({
  inputPer1k: z.number().finite().min(0).default(0.003),
  outputPer1k: z.number().finite().min(0).default(0.015),
  cacheReadPer1k: z.number().finite().min(0).default(0.0003),
  cacheWritePer1k: z.number().finite().min(0).default(0.00375),
})
export type EffortPrices = z.infer<typeof EffortPricesSchema>

export const EffortReportChannelSchema = z.enum(["toast", "log", "parent", "off"])
export type EffortReportChannel = z.infer<typeof EffortReportChannelSchema>

export const EffortConfigSchema = z.object({
  /** Enable per-session effort accounting. Default: true */
  enabled: z.boolean().default(true),
  /** Where the effort report is delivered. Default: ["parent"] */
  report: z.array(EffortReportChannelSchema).default(["parent"]),
  /** Relative contribution of each effort dimension. Defaults: 0.5/0.25/0.15/0.1 */
  weights: EffortWeightsSchema.default({ compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 }),
  /** USD prices per 1k tokens. Defaults mirror a mid-tier provider */
  prices: EffortPricesSchema.default({
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheWritePer1k: 0.00375,
  }),
  /** Flat per-tool cost in USD, keyed by tool name. Default: {} */
  toolCosts: z.record(z.string(), z.number().finite().min(0)).default({}),
  /** Maximum messages retained per effort trace. Default: 200 */
  maxMessages: z.number().int().min(1).default(200),
  /** Maximum serialized trace bytes. Default: 2 MiB */
  maxBytes: z.number().int().min(1024).default(2_097_152),
  /** Aggregate child-agent effort into the parent report. Default: false */
  rollup: z.boolean().default(false),
})
export type EffortConfig = z.infer<typeof EffortConfigSchema>
