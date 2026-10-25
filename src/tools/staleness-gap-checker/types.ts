export type StalenessState = "healthy" | "warn" | "stale" | "unknown"

export interface StalenessSample {
  symbol: string
  exchange: string
  seq: number
  exchange_ts: number | string
  pub_ts?: number | string
}

export type GapKind = "gap" | "regression" | "duplicate"

export interface GapFinding {
  symbol: string
  exchange: string
  kind: GapKind
  fromSeq: number
  toSeq: number
  missing?: number
}

export interface StalenessEntry {
  symbol: string
  exchange: string
  ageMs: number
  expectedIntervalMs: number | null
  state: StalenessState
}

export interface StalenessSummary {
  samples: number
  groups: number
  gaps: number
  regressions: number
  duplicates: number
  stale: number
  warn: number
  healthy: number
  invalidLines?: number
  note?: string
}

export interface StalenessResult {
  status: 0 | 1 | 2
  gaps: GapFinding[]
  staleness: StalenessEntry[]
  summary: StalenessSummary
}
