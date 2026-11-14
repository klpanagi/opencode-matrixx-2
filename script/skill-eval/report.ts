import { PASS_THRESHOLD } from "./constants"
import { asRecord } from "./json"

export interface QualityRow {
  skillName: string
  score: number | null
  grade: string | null
  dimensions: {
    correctness: number | null
    discoverability: number | null
    reliability: number | null
    efficiency: number | null
  }
  estimatedTokens: number | null
  issues: string[]
  reason?: string
}

export interface CatalogSkillResult {
  name: string
  passed: boolean
  reason: string | null
  overallStatus: string | null
  incompleteScans: string[]
  severityCounts: Record<string, number>
}

export interface CatalogSummary {
  total: number
  passed: number
  failed: number
  overallPassed: boolean
  severityTotals: Record<string, number>
  skills: CatalogSkillResult[]
}

const DIMENSION_NAMES = ["correctness", "discoverability", "reliability", "efficiency"] as const

function numericRecord(value: unknown): Record<string, number> {
  const record = asRecord(value)
  const result: Record<string, number> = {}
  if (!record) return result
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number") result[key] = entry
  }
  return result
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null
  const scaled = value <= 1 ? value * 100 : value
  return Math.round(scaled * 10) / 10
}

function dimensionScore(dimensions: Record<string, unknown> | undefined, name: string): number | null {
  if (!dimensions) return null
  const dimension = asRecord(dimensions[name])
  return dimension ? normalizeScore(dimension.score) : null
}

function collectIssueMessages(dimensions: Record<string, unknown> | undefined): string[] {
  if (!dimensions) return []
  const messages: string[] = []
  for (const name of DIMENSION_NAMES) {
    const dimension = asRecord(dimensions[name])
    if (!dimension || !Array.isArray(dimension.issues)) continue
    for (const issue of dimension.issues) {
      const record = asRecord(issue)
      if (record && typeof record.message === "string") messages.push(record.message)
    }
  }
  return messages
}

export function unscoredRow(skillName: string, reason: string): QualityRow {
  return {
    skillName,
    score: null,
    grade: null,
    dimensions: { correctness: null, discoverability: null, reliability: null, efficiency: null },
    estimatedTokens: null,
    issues: [],
    reason,
  }
}

export function parseQualityReport(payload: unknown, requestedSkill = ""): QualityRow {
  const root = asRecord(payload)
  if (!root) return unscoredRow(requestedSkill, "quality report is not a JSON object")
  let candidate: Record<string, unknown> | undefined
  if (Array.isArray(root.quality_summary)) {
    if (root.quality_summary.length === 0) return unscoredRow(requestedSkill, "quality_summary is empty")
    const entries = root.quality_summary
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    if (entries.length === 0) return unscoredRow(requestedSkill, "quality_summary has no usable entries")
    candidate = entries.find((entry) => entry.skill_name === requestedSkill) ?? entries[0]
  } else if (typeof root.overall_score === "number") {
    candidate = root
  } else {
    return unscoredRow(requestedSkill, "report has no quality_summary or overall_score")
  }
  if (typeof candidate.overall_score !== "number") {
    return unscoredRow(requestedSkill, "quality entry has no numeric overall_score")
  }
  const dimensions = asRecord(candidate.dimensions)
  const metrics = asRecord(candidate.metrics)
  return {
    skillName: typeof candidate.skill_name === "string" ? candidate.skill_name : requestedSkill,
    score: normalizeScore(candidate.overall_score),
    grade: typeof candidate.grade === "string" ? candidate.grade : null,
    dimensions: {
      correctness: dimensionScore(dimensions, "correctness"),
      discoverability: dimensionScore(dimensions, "discoverability"),
      reliability: dimensionScore(dimensions, "reliability"),
      efficiency: dimensionScore(dimensions, "efficiency"),
    },
    estimatedTokens: metrics && typeof metrics.estimated_tokens === "number" ? metrics.estimated_tokens : null,
    issues: collectIssueMessages(dimensions),
  }
}

export function parseCatalogSummary(payload: unknown): CatalogSummary | null {
  const root = asRecord(payload)
  if (!root || !Array.isArray(root.skills)) return null
  const skills: CatalogSkillResult[] = []
  for (const entry of root.skills) {
    const record = asRecord(entry)
    if (!record || typeof record.name !== "string") continue
    skills.push({
      name: record.name,
      passed: record.passed === true,
      reason: typeof record.reason === "string" ? record.reason : null,
      overallStatus: typeof record.overall_status === "string" ? record.overall_status : null,
      incompleteScans: stringArray(record.incomplete_scans),
      severityCounts: numericRecord(record.severity_counts),
    })
  }
  if (skills.length === 0) return null
  return {
    total: typeof root.total === "number" ? root.total : skills.length,
    passed: typeof root.passed === "number" ? root.passed : skills.filter((skill) => skill.passed).length,
    failed: typeof root.failed === "number" ? root.failed : skills.filter((skill) => !skill.passed).length,
    overallPassed: root.overall_passed === true,
    severityTotals: numericRecord(root.severity_totals),
    skills,
  }
}

export interface QualitySummary {
  scored: number
  passing: number
  belowThreshold: number
  mean: number | null
}

export function isScored(row: QualityRow): row is QualityRow & { score: number } {
  return row.score !== null
}

export function summarize(rows: QualityRow[]): QualitySummary {
  const scored = rows.filter(isScored)
  const mean =
    scored.length > 0
      ? Math.round((scored.reduce((total, row) => total + row.score, 0) / scored.length) * 10) / 10
      : null
  return {
    scored: scored.length,
    passing: scored.filter((row) => row.score >= PASS_THRESHOLD).length,
    belowThreshold: scored.filter((row) => row.score < PASS_THRESHOLD).length,
    mean,
  }
}

function formatScore(value: number | null): string {
  if (value === null) return "n/a"
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function compareQualityRows(left: QualityRow, right: QualityRow): number {
  if (left.score === null && right.score === null) return left.skillName.localeCompare(right.skillName)
  if (left.score === null) return 1
  if (right.score === null) return -1
  return left.score - right.score || left.skillName.localeCompare(right.skillName)
}

export function topDeductionMessages(rows: QualityRow[], limit = 5): Array<{ message: string; count: number }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const message of row.issues) counts.set(message, (counts.get(message) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
    .slice(0, limit)
}

export function formatSummaryTable(rows: QualityRow[]): string {
  const sorted = [...rows].sort(compareQualityRows)
  const lines = [
    "| skill | score | grade | correctness | discoverability | reliability | efficiency |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...sorted.map(
      (row) =>
        `| ${row.skillName} | ${formatScore(row.score)} | ${row.grade ?? "n/a"} | ${formatScore(row.dimensions.correctness)} | ${formatScore(row.dimensions.discoverability)} | ${formatScore(row.dimensions.reliability)} | ${formatScore(row.dimensions.efficiency)} |`,
    ),
  ]
  const summary = summarize(rows)
  const mean = summary.mean === null ? "n/a" : summary.mean.toFixed(1)
  lines.push("")
  lines.push(
    `passing (>=${PASS_THRESHOLD}): ${summary.passing} | below ${PASS_THRESHOLD}: ${summary.belowThreshold} | mean: ${mean} | unscored: ${rows.length - summary.scored}`,
  )
  lines.push("n/a = unscored: no quality report was produced (see Unscored skills)")
  return lines.join("\n")
}
