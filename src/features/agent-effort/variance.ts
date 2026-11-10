export const VARIANCE_FLAG_THRESHOLD = 0.5

export type VarianceFlag = "over" | "under" | "ontrack" | "unknown"

export interface PlanVarianceInput {
  actual: number | null | undefined
  estimate: number | null | undefined
}

export interface PlanVariance {
  delta: number | null
  pct: number | null
  flag: VarianceFlag
}

export interface PlanActualShape {
  total: number | null | undefined
  tokenUsd: number | null | undefined
}

export interface PlanEstimateShape {
  total: number | null | undefined
}

export interface PlanVarianceSummary {
  totalDelta: number | null
  totalPct: number | null
  totalFlag: VarianceFlag
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function computeVariance(input: PlanVarianceInput): PlanVariance {
  try {
    const source = (input ?? {}) as Partial<PlanVarianceInput>
    const actual = finiteOrNull(source.actual)
    const estimate = finiteOrNull(source.estimate)
    if (actual === null || estimate === null) {
      return { delta: null, pct: null, flag: "unknown" }
    }
    const delta = finiteOrNull(actual - estimate)
    if (delta === null) {
      return { delta: null, pct: null, flag: "unknown" }
    }
    const pct = estimate !== 0 ? finiteOrNull(delta / estimate) : null
    if (pct === null) {
      return { delta, pct: null, flag: "ontrack" }
    }
    if (Math.abs(pct) > VARIANCE_FLAG_THRESHOLD) {
      return { delta, pct, flag: delta > 0 ? "over" : delta < 0 ? "under" : "ontrack" }
    }
    return { delta, pct, flag: "ontrack" }
  } catch {
    return { delta: null, pct: null, flag: "unknown" }
  }
}

export function computePlanVariance(
  actual: PlanActualShape,
  estimate: PlanEstimateShape,
): PlanVarianceSummary {
  try {
    const source = (actual ?? {}) as Partial<PlanActualShape>
    const target = (estimate ?? {}) as Partial<PlanEstimateShape>
    const result = computeVariance({ actual: source.total, estimate: target.total })
    return { totalDelta: result.delta, totalPct: result.pct, totalFlag: result.flag }
  } catch {
    return { totalDelta: null, totalPct: null, totalFlag: "unknown" }
  }
}
