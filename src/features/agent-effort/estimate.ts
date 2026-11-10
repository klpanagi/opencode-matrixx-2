export interface TodoEffortEstimate {
  units: number
  method: "fallback"
}

export interface PlanEffortEstimateInput {
  perTodo: Record<string, number>
  total: number
  method: "fallback" | "human" | "mixed"
}

export interface ParsedEffortEstimate {
  perTodo?: Record<string, number>
  total?: number
  method?: string
}

const COMPLEXITY_RE =
  /refactor|migrat|parallel|concurren|security|auth|schema|architect|multi-|cross-cutting|performance|optimiz/gi
const FILE_PATH_RE = /[\w\-./]+\.(ts|tsx|js|md|json|yaml|yml)/g
const VERIFICATION_RE = /test|typecheck|lint|build|verify/gi

const ESTIMATE_TAG_PREFIX = "<!-- effort-estimate:"
const ESTIMATE_TAG_SUFFIX = "-->"

function countMatches(text: string, regex: RegExp): number {
  regex.lastIndex = 0
  const matches = text.match(regex)
  regex.lastIndex = 0
  return matches === null ? 0 : matches.length
}

function round2dp(value: number): number {
  return Math.round(value * 100) / 100
}

export function estimateTodoEffort(todoText: string): TodoEffortEstimate {
  try {
    const text = typeof todoText === "string" ? todoText : ""
    const complexityHits = countMatches(text, COMPLEXITY_RE)
    const fileHits = countMatches(text, FILE_PATH_RE)
    const verificationHits = countMatches(text, VERIFICATION_RE)
    const complexityUnits = Math.min(complexityHits * 0.5, 2.0)
    const fileUnits = Math.min(fileHits * 0.3, 1.5)
    const verificationUnits = Math.min(verificationHits * 0.2, 1.0)
    const units = round2dp(0.5 + complexityUnits + fileUnits + verificationUnits)
    const safe = Number.isFinite(units) ? units : 0.5
    return { units: Math.max(safe, 0.5), method: "fallback" }
  } catch {
    return { units: 0.5, method: "fallback" }
  }
}

function sanitizePerTodo(value: unknown): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0) out[key] = entry
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function parseEffortEstimateComment(content: string): ParsedEffortEstimate | null {
  try {
    if (typeof content !== "string") return null
    const regex = new RegExp(`${escapeRegExp(ESTIMATE_TAG_PREFIX)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(ESTIMATE_TAG_SUFFIX)}`)
    const match = content.match(regex)
    if (!match?.[1]) return null
    const parsed: unknown = JSON.parse(match[1])
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const result: ParsedEffortEstimate = {}
    const perTodo = sanitizePerTodo(record.perTodo)
    if (perTodo !== undefined) result.perTodo = perTodo
    if (typeof record.total === "number" && Number.isFinite(record.total)) result.total = record.total
    if (typeof record.method === "string") result.method = record.method
    return result
  } catch {
    return null
  }
}

export function upsertEffortEstimateComment(content: string, estimate: PlanEffortEstimateInput): string {
  const base = typeof content === "string" ? content : ""
  const existing = parseEffortEstimateComment(base)
  const fallbackTodo = sanitizePerTodo(estimate.perTodo) ?? {}
  let mergedPerTodo: Record<string, number> = { ...fallbackTodo }
  let method: "fallback" | "human" | "mixed" = estimate.method
  if (existing?.perTodo !== undefined) {
    const humanTodo = existing.perTodo
    mergedPerTodo = { ...fallbackTodo }
    for (const [key, value] of Object.entries(humanTodo)) mergedPerTodo[key] = value
    const hasHuman = Object.keys(humanTodo).length > 0
    const hasFallback = Object.keys(fallbackTodo).length > 0
    if (hasHuman && hasFallback) method = "mixed"
    else if (hasHuman && !hasFallback) method = existing.method === "mixed" ? "mixed" : "human"
  }
  const mergedTotal = round2dp(Object.values(mergedPerTodo).reduce((sum, v) => sum + v, 0))
  const tag = `${ESTIMATE_TAG_PREFIX} ${JSON.stringify({ perTodo: mergedPerTodo, total: mergedTotal, method })} ${ESTIMATE_TAG_SUFFIX}`
  const regex = new RegExp(`${escapeRegExp(ESTIMATE_TAG_PREFIX)}\\s*[\\s\\S]*?\\s*${escapeRegExp(ESTIMATE_TAG_SUFFIX)}`, "g")
  if (regex.test(base)) return base.replace(regex, tag)
  return `${base.replace(/\n*$/, "")}\n\n${tag}\n`
}
