import type { EffortPrices, EffortReportChannel, EffortWeights } from "./types"

/** Bump when the scoring semantics change; persisted with every EffortRecord. */
export const FORMULA_VERSION = 1

/** Default dimension weights. Must be finite; they need not sum to 1 (computeEffort normalizes defensively). */
export const DEFAULT_WEIGHTS: EffortWeights = {
  compute: 0.5,
  action: 0.25,
  epistemic: 0.15,
  coord: 0.1,
}

/** USD per 1K tokens. reasoning is billed at the output rate. */
export const DEFAULT_PRICES: EffortPrices = {
  inputPer1k: 0.003,
  outputPer1k: 0.015,
  cacheReadPer1k: 0.0003,
  cacheWritePer1k: 0.00375,
}

export const DEFAULT_REPORT: EffortReportChannel[] = ["parent"]
export const DEFAULT_TOOL_COSTS: Record<string, number> = {}
export const DEFAULT_MAX_MESSAGES = 200
export const DEFAULT_MAX_BYTES = 2_097_152
export const DEFAULT_ROLLUP = false
