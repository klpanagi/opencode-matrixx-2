import { DEFAULT_PRICES, DEFAULT_WEIGHTS, FORMULA_VERSION } from "./constants"
import type { EffortCoverage, EffortPrices, EffortRecord, EffortTelemetry, EffortWeights } from "./types"

export interface ComputeEffortOptions {
  coverage?: EffortCoverage
  missing?: string[]
  computedAt?: string
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function sanitizeWeights(weights?: EffortWeights): EffortWeights {
  const source = weights ?? DEFAULT_WEIGHTS
  const compute = nonNegative(source.compute)
  const action = nonNegative(source.action)
  const epistemic = nonNegative(source.epistemic)
  const coord = nonNegative(source.coord)
  const sum = compute + action + epistemic + coord

  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_WEIGHTS }
  }

  return {
    compute: compute / sum,
    action: action / sum,
    epistemic: epistemic / sum,
    coord: coord / sum,
  }
}

function priceOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function sanitizePrices(prices?: EffortPrices): EffortPrices {
  const source = prices ?? DEFAULT_PRICES
  return {
    inputPer1k: priceOr(source.inputPer1k, DEFAULT_PRICES.inputPer1k),
    outputPer1k: priceOr(source.outputPer1k, DEFAULT_PRICES.outputPer1k),
    cacheReadPer1k: priceOr(source.cacheReadPer1k, DEFAULT_PRICES.cacheReadPer1k),
    cacheWritePer1k: priceOr(source.cacheWritePer1k, DEFAULT_PRICES.cacheWritePer1k),
  }
}

export function computeEffort(
  telemetry: EffortTelemetry,
  weights?: EffortWeights,
  prices?: EffortPrices,
  options?: ComputeEffortOptions,
): EffortRecord {
  const source: Partial<EffortTelemetry> = telemetry ?? {}

  const sanitizedTelemetry: EffortTelemetry = {
    input: nonNegative(source.input),
    output: nonNegative(source.output),
    reasoning: nonNegative(source.reasoning),
    cacheRead: nonNegative(source.cacheRead),
    cacheWrite: nonNegative(source.cacheWrite),
    steps: nonNegative(source.steps),
    toolCalls: nonNegative(source.toolCalls),
    uniqueTools: nonNegative(source.uniqueTools),
    retries: nonNegative(source.retries),
    durationMs: nonNegative(source.durationMs),
  }

  const safePrices = sanitizePrices(prices)
  const safeWeights = sanitizeWeights(weights)

  const tokenUsd = safe(
    (sanitizedTelemetry.input / 1000) * safePrices.inputPer1k +
      (sanitizedTelemetry.output / 1000) * safePrices.outputPer1k +
      (sanitizedTelemetry.reasoning / 1000) * safePrices.outputPer1k +
      (sanitizedTelemetry.cacheRead / 1000) * safePrices.cacheReadPer1k +
      (sanitizedTelemetry.cacheWrite / 1000) * safePrices.cacheWritePer1k,
  )

  const computeUnits = safePrices.outputPer1k > 0 ? safe((tokenUsd * 1000) / safePrices.outputPer1k) : 0
  const actionUnits = safe(
    sanitizedTelemetry.toolCalls + 2 * sanitizedTelemetry.retries + 0.1 * sanitizedTelemetry.steps,
  )
  const epistemicUnits = safe(Math.log1p(sanitizedTelemetry.toolCalls) + Math.log1p(sanitizedTelemetry.uniqueTools))
  const coordUnits = 0

  const total = safe(
    safeWeights.compute * (computeUnits / 1000) +
      safeWeights.action * (actionUnits / 50) +
      safeWeights.epistemic * (epistemicUnits / 10) +
      safeWeights.coord * (coordUnits / 10),
  )

  return {
    formulaVersion: FORMULA_VERSION,
    total,
    tokenUsd,
    components: {
      computeUnits,
      actionUnits,
      epistemicUnits,
      coordUnits,
      tokenUsd,
      total,
    },
    telemetry: sanitizedTelemetry,
    coverage: options?.coverage ?? "full",
    missing: [...(options?.missing ?? [])],
    computedAt: options?.computedAt ?? new Date().toISOString(),
  }
}
