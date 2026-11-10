import { parseMetadataComment } from "../mission-state/plan-storage"
import { computeVariance } from "./variance"

export interface PlanEffortActual {
  total: number
  tokenUsd: number
  taskCount: number
  computedAt?: string
}

export interface PlanEffortEstimate {
  total?: number
  perTodo?: Record<string, number>
  method?: string
}

export interface PlanEffortVariance {
  delta: number | null
  pct: number | null
}

export interface PlanEffortSurface {
  effortActual?: PlanEffortActual
  estimate?: PlanEffortEstimate
  variance?: PlanEffortVariance
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function sanitizeActual(value: unknown): PlanEffortActual | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const total = finiteNumber(source.total)
  if (total === null) return undefined
  const tokenUsd = finiteNumber(source.tokenUsd) ?? 0
  const taskCount = nonNegativeInt(source.taskCount) ?? 0
  const computedAt = typeof source.computedAt === "string" ? source.computedAt : undefined
  return computedAt === undefined ? { total, tokenUsd, taskCount } : { total, tokenUsd, taskCount, computedAt }
}

function sanitizeEstimate(value: unknown): PlanEffortEstimate | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const total = finiteNumber(source.total)
  const method = typeof source.method === "string" ? source.method : undefined
  let perTodo: Record<string, number> | undefined
  const rawPerTodo = source.perTodo
  if (rawPerTodo !== null && typeof rawPerTodo === "object" && !Array.isArray(rawPerTodo)) {
    const entries: Record<string, number> = {}
    for (const [key, entry] of Object.entries(rawPerTodo as Record<string, unknown>)) {
      const units = finiteNumber(entry)
      if (units !== null && units >= 0) entries[key] = units
    }
    if (Object.keys(entries).length > 0) perTodo = entries
  }
  if (total === null && perTodo === undefined && method === undefined) return undefined
  const out: PlanEffortEstimate = {}
  if (total !== null) out.total = total
  if (perTodo !== undefined) out.perTodo = perTodo
  if (method !== undefined) out.method = method
  return out
}

function sanitizeVariance(value: unknown): PlanEffortVariance | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const delta = "delta" in source ? finiteNumber(source.delta) : null
  const pct = "pct" in source ? finiteNumber(source.pct) : null
  if (!("delta" in source) && !("pct" in source)) return undefined
  return { delta, pct }
}

export function extractPlanEffort(content: string): PlanEffortSurface | undefined {
  try {
    if (typeof content !== "string" || content.length === 0) return undefined
    const meta = parseMetadataComment(content)
    if (meta === null) return undefined
    const effortActual = sanitizeActual(meta.effortActual)
    const estimate = sanitizeEstimate(meta.estimate)
    const variance = sanitizeVariance(meta.variance)
    if (effortActual === undefined && estimate === undefined && variance === undefined) return undefined
    const surface: PlanEffortSurface = {}
    if (effortActual !== undefined) surface.effortActual = effortActual
    if (estimate !== undefined) surface.estimate = estimate
    if (variance !== undefined) surface.variance = variance
    return surface
  } catch {
    return undefined
  }
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function formatSigned(value: number): string {
  const text = formatAmount(Math.abs(value))
  if (value > 0) return `+${text}`
  if (value < 0) return `-${text}`
  return "0"
}

export function formatEffortSummary(surface: PlanEffortSurface | undefined): string | null {
  try {
    if (surface === undefined) return null
    const actual = surface.effortActual
    const estimateTotal = surface.estimate?.total
    if (actual === undefined && estimateTotal === undefined) return null
    const segments: string[] = []
    if (actual !== undefined) {
      segments.push(`actual ${formatAmount(actual.total)} ($${formatAmount(actual.tokenUsd)}, ${actual.taskCount} tasks)`)
    }
    if (estimateTotal !== undefined) {
      segments.push(`estimate ${formatAmount(estimateTotal)}`)
    }
    if (actual !== undefined && estimateTotal !== undefined) {
      const variance = computeVariance({ actual: actual.total, estimate: estimateTotal })
      if (variance.delta !== null && variance.pct !== null) {
        segments.push(`Δ${formatSigned(variance.delta)} (${formatSigned(variance.pct * 100)}%, ${variance.flag})`)
      }
    }
    return `Effort: ${segments.join(" vs ")}`
  } catch {
    return null
  }
}
