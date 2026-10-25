import { DEFAULT_MAX_GAP_MULTIPLIER, STALE_MULTIPLIER } from "./constants"
import type {
  GapFinding,
  StalenessEntry,
  StalenessResult,
  StalenessSample,
  StalenessState,
} from "./types"

const GROUP_SEPARATOR = "\u0000"

export function toMillis(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function maxOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  let max = values[0]
  for (const value of values) if (value > max) max = value
  return max
}

/**
 * Validates and normalizes a raw parsed object into a sample, or returns null
 * when the object does not carry the required shape.
 */
export function coerceSample(raw: unknown): StalenessSample | null {
  if (typeof raw !== "object" || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.symbol !== "string" || typeof record.exchange !== "string") return null
  if (typeof record.seq !== "number" || !Number.isFinite(record.seq)) return null
  const ts = record.exchange_ts
  if (typeof ts !== "number" && typeof ts !== "string") return null
  const pub = record.pub_ts
  if (pub !== undefined && typeof pub !== "number" && typeof pub !== "string") return null
  const sample: StalenessSample = {
    symbol: record.symbol,
    exchange: record.exchange,
    seq: record.seq,
    exchange_ts: ts,
  }
  if (pub !== undefined) sample.pub_ts = pub
  return sample
}

export function parseNdjson(text: string): { samples: StalenessSample[]; invalid: number } {
  const samples: StalenessSample[] = []
  let invalid = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try {
      const parsed = JSON.parse(trimmed)
      const sample = coerceSample(parsed)
      if (sample) samples.push(sample)
      else invalid += 1
    } catch {
      invalid += 1
    }
  }
  return { samples, invalid }
}

export function analyzeSamples(
  samples: StalenessSample[],
  opts: { maxGapMultiplier?: number; now?: number } = {},
): StalenessResult {
  const multiplier = opts.maxGapMultiplier ?? DEFAULT_MAX_GAP_MULTIPLIER

  const groups = new Map<string, StalenessSample[]>()
  for (const sample of samples) {
    const key = `${sample.symbol}${GROUP_SEPARATOR}${sample.exchange}`
    const existing = groups.get(key)
    if (existing) existing.push(sample)
    else groups.set(key, [sample])
  }

  const pubTimes: number[] = []
  const exTimes: number[] = []
  for (const sample of samples) {
    const pub = toMillis(sample.pub_ts)
    if (pub !== null) pubTimes.push(pub)
    const ex = toMillis(sample.exchange_ts)
    if (ex !== null) exTimes.push(ex)
  }
  const nowMs = opts.now ?? maxOrNull(pubTimes) ?? maxOrNull(exTimes) ?? 0

  const gaps: GapFinding[] = []
  const staleness: StalenessEntry[] = []
  let stale = 0
  let warn = 0
  let healthy = 0

  for (const [key, group] of groups) {
    const separator = key.indexOf(GROUP_SEPARATOR)
    const symbol = separator >= 0 ? key.slice(0, separator) : key
    const exchange = separator >= 0 ? key.slice(separator + 1) : ""

    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]
      const cur = group[i]
      if (cur.seq < prev.seq) {
        gaps.push({ symbol, exchange, kind: "regression", fromSeq: prev.seq, toSeq: cur.seq })
      } else if (cur.seq === prev.seq) {
        gaps.push({ symbol, exchange, kind: "duplicate", fromSeq: prev.seq, toSeq: cur.seq })
      } else if (cur.seq > prev.seq + 1) {
        gaps.push({
          symbol,
          exchange,
          kind: "gap",
          fromSeq: prev.seq,
          toSeq: cur.seq,
          missing: cur.seq - prev.seq - 1,
        })
      }
    }

    const ex = group
      .map((sample) => toMillis(sample.exchange_ts))
      .filter((value): value is number => value !== null)
    const deltas: number[] = []
    for (let i = 1; i < ex.length; i++) {
      const delta = ex[i] - ex[i - 1]
      if (delta > 0) deltas.push(delta)
    }
    const expected = median(deltas)
    const lastEx = maxOrNull(ex)

    let state: StalenessState = "unknown"
    let ageMs = 0
    if (lastEx !== null) {
      ageMs = Math.max(0, nowMs - lastEx)
      if (expected === null || expected <= 0) state = "unknown"
      else if (ageMs > STALE_MULTIPLIER * expected) state = "stale"
      else if (ageMs > multiplier * expected) state = "warn"
      else state = "healthy"
    }
    if (state === "stale") stale += 1
    else if (state === "warn") warn += 1
    else if (state === "healthy") healthy += 1

    staleness.push({ symbol, exchange, ageMs, expectedIntervalMs: expected, state })
  }

  let gapCount = 0
  let regressionCount = 0
  let duplicateCount = 0
  for (const item of gaps) {
    if (item.kind === "gap") gapCount += 1
    else if (item.kind === "regression") regressionCount += 1
    else duplicateCount += 1
  }

  const hasError = regressionCount > 0 || stale > 0
  const hasWarning = gapCount > 0 || duplicateCount > 0 || warn > 0
  const status: 0 | 1 | 2 = hasError ? 2 : hasWarning ? 1 : 0

  return {
    status,
    gaps,
    staleness,
    summary: {
      samples: samples.length,
      groups: groups.size,
      gaps: gapCount,
      regressions: regressionCount,
      duplicates: duplicateCount,
      stale,
      warn,
      healthy,
    },
  }
}
