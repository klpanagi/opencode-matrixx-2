export type SymbolSeverity = "warn" | "error"

export interface SymbolFinding {
  rule: string
  severity: SymbolSeverity
  file: string
  line: number
  symbol: string
  issue: string
  fix: string
}

export interface SymbolSummary {
  filesScanned: number
  total: number
  byRule: Record<string, number>
  note?: string
}

export interface SymbolValidationResult {
  status: 0 | 1 | 2
  findings: SymbolFinding[]
  summary: SymbolSummary
}
