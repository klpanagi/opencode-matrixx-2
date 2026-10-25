export type FluxSeverity = "warn" | "error"

export interface FluxFinding {
  rule: string
  severity: FluxSeverity
  file: string
  line: number
  excerpt: string
  fix: string
}

export interface FluxSummary {
  filesScanned: number
  total: number
  byRule: Record<string, number>
  note?: string
}

export interface FluxValidationResult {
  status: 0 | 1 | 2
  findings: FluxFinding[]
  summary: FluxSummary
}
