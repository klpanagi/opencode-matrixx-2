export interface EffortTelemetry {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  steps: number
  toolCalls: number
  uniqueTools: number
  retries: number
  durationMs: number
}

export type EffortCoverage = "full" | "partial"

export interface EffortWeights {
  compute: number
  action: number
  epistemic: number
  coord: number
}

export interface EffortPrices {
  inputPer1k: number
  outputPer1k: number
  cacheReadPer1k: number
  cacheWritePer1k: number
}

export interface EffortComponents {
  computeUnits: number
  actionUnits: number
  epistemicUnits: number
  coordUnits: number
  tokenUsd: number
  total: number
}

export interface EffortRecord {
  formulaVersion: number
  total: number
  tokenUsd: number
  components: EffortComponents
  telemetry: EffortTelemetry
  coverage: EffortCoverage
  missing: string[]
  computedAt: string // ISO timestamp
}

export type EffortReportChannel = "toast" | "log" | "parent" | "off"

export interface EffortConfig {
  enabled: boolean
  report: EffortReportChannel[]
  weights: EffortWeights
  prices: EffortPrices
  toolCosts: Record<string, number>
  maxMessages: number
  maxBytes: number
  rollup: boolean
}
