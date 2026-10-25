import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { DASHBOARD_EXTENSIONS, IGNORED_DIRS, RULE_CATALOG } from "./constants"
import type { FluxFinding, FluxSeverity, FluxValidationResult } from "./types"

interface ScanState {
  provisionedFlux: boolean
  dashboards: Set<string>
}

interface FluxLint {
  rule: string
  excerpt: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function makeFinding(rule: string, file: string, line: number, excerpt: string): FluxFinding {
  const meta = RULE_CATALOG[rule]
  const severity: FluxSeverity = meta?.severity ?? "warn"
  return {
    rule,
    severity,
    file,
    line,
    excerpt: excerpt.trim().slice(0, 160),
    fix: meta?.fix ?? "Review the Flux query.",
  }
}

function firstLine(query: string): string {
  return query.split("\n")[0]
}

function lineFor(raw: string, needle: string): number {
  if (needle === "") return 1
  const index = raw.indexOf(needle)
  if (index < 0) return 1
  return raw.slice(0, index).split("\n").length
}

function walkJson(node: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJson(item, visit)
    return
  }
  const record = asRecord(node)
  if (!record) return
  visit(record)
  for (const value of Object.values(record)) walkJson(value, visit)
}

function resolveDashboard(root: unknown): Record<string, unknown> | null {
  const record = asRecord(root)
  if (!record) return null
  const wrapped = asRecord(record.dashboard)
  if (wrapped && Array.isArray(wrapped.panels)) return wrapped
  const spec = asRecord(record.spec)
  if (spec && Array.isArray(spec.panels)) return spec
  if (Array.isArray(record.panels)) return record
  return null
}

function lintFlux(query: string): FluxLint[] {
  const out: FluxLint[] = []
  const excerpt = firstLine(query)
  if (/\|>\s*to\s*\(/.test(query) && !/timeColumn\s*:/.test(query)) {
    out.push({ rule: "GF001", excerpt })
  }
  if (/\b(?:mean|sum|max|min)\s*\(/.test(query) && !/toFloat\s*\(/.test(query)) {
    out.push({ rule: "GF002", excerpt })
  }
  if (/createEmpty\s*[:=]\s*true/i.test(query)) {
    out.push({ rule: "GF003", excerpt })
  }
  if (/\bjoin(?:\.time)?\s*\(/.test(query) && !/\bpivot\s*\(/.test(query)) {
    out.push({ rule: "GF004", excerpt })
  }
  return out
}

function handleJson(raw: string, rel: string, state: ScanState, findings: FluxFinding[]): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }

  walkJson(parsed, (record) => {
    if (typeof record.type === "string" && /influxdb/i.test(record.type)) state.provisionedFlux = true
  })

  const dashboard = resolveDashboard(parsed)
  if (!dashboard) return
  state.dashboards.add(rel)

  const templating = asRecord(dashboard.templating)
  const variables = templating ? templating.list : undefined
  if (Array.isArray(variables)) {
    for (const variable of variables) {
      const record = asRecord(variable)
      if (!record) continue
      const name = typeof record.name === "string" ? record.name : ""
      if (!/symbol|market|pair|instrument/i.test(name)) continue
      const query = typeof record.query === "string" ? record.query : ""
      if (!/schema\.tagValues\s*\(/.test(query)) {
        findings.push(makeFinding("VAR001", rel, lineFor(raw, query), `variable "${name}": ${query || "<no query>"}`))
      }
    }
  }

  const panels = dashboard.panels
  if (!Array.isArray(panels)) return
  for (const panel of panels) {
    const record = asRecord(panel)
    if (!record) continue
    const title = typeof record.title === "string" ? record.title : ""
    if (/stale|lag|age|fresh|delay|gap/i.test(title)) {
      const fieldConfig = asRecord(record.fieldConfig)
      const defaults = fieldConfig ? asRecord(fieldConfig.defaults) : null
      const mappings = defaults ? defaults.mappings : undefined
      const thresholds = defaults ? asRecord(defaults.thresholds) : null
      const steps = thresholds ? thresholds.steps : undefined
      const hasMapping =
        (Array.isArray(mappings) && mappings.length > 0) || (Array.isArray(steps) && steps.length > 0)
      if (!hasMapping) findings.push(makeFinding("PAN001", rel, 1, `panel "${title}" has no value mappings`))
    }

    const targets = record.targets
    if (!Array.isArray(targets)) continue
    for (const target of targets) {
      const targetRecord = asRecord(target)
      if (!targetRecord) continue
      const query =
        typeof targetRecord.query === "string"
          ? targetRecord.query
          : typeof targetRecord.expr === "string"
            ? targetRecord.expr
            : ""
      if (query === "") continue
      for (const item of lintFlux(query)) {
        findings.push(makeFinding(item.rule, rel, lineFor(raw, query), item.excerpt))
      }
    }
  }
}

function handleYaml(raw: string, rel: string, state: ScanState, findings: FluxFinding[]): void {
  const lines = raw.split("\n")
  const hasTimeColumn = /timeColumn\s*:/.test(raw)
  const hasPivot = /\bpivot\s*\(/.test(raw)
  const hasToFloat = /toFloat\s*\(/.test(raw)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*type\s*:\s*influxdb\b/i.test(line)) state.provisionedFlux = true
    if (/\|>\s*to\s*\(/.test(line) && !hasTimeColumn) findings.push(makeFinding("GF001", rel, i + 1, line))
    if (/\b(?:mean|sum|max|min)\s*\(/.test(line) && !hasToFloat) findings.push(makeFinding("GF002", rel, i + 1, line))
    if (/createEmpty\s*[:=]\s*true/i.test(line)) findings.push(makeFinding("GF003", rel, i + 1, line))
    if (/\bjoin(?:\.time)?\s*\(/.test(line) && !hasPivot) findings.push(makeFinding("GF004", rel, i + 1, line))
  }
}

function collectFiles(target: string): string[] {
  if (!existsSync(target)) return []
  if (statSync(target).isFile()) return [target]
  const out: string[] = []
  const stack = [target]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    let entries: import("node:fs").Dirent<string>[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        stack.push(full)
      } else if (entry.isFile() && DASHBOARD_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

function displayPath(base: string, abs: string): string {
  const rel = relative(base, abs)
  return rel.startsWith("..") ? abs : rel
}

function buildResult(findings: FluxFinding[], filesScanned: number): FluxValidationResult {
  const byRule: Record<string, number> = {}
  let errors = 0
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1
    if (finding.severity === "error") errors += 1
  }
  const status: 0 | 1 | 2 = errors > 0 ? 2 : findings.length > 0 ? 1 : 0
  return { status, findings, summary: { filesScanned, total: findings.length, byRule } }
}

export function validateDashboard(opts: { base: string; target: string }): FluxValidationResult {
  const files = collectFiles(opts.target)
  const state: ScanState = { provisionedFlux: false, dashboards: new Set() }
  const findings: FluxFinding[] = []

  for (const file of files) {
    let raw: string
    try {
      raw = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const rel = displayPath(opts.base, file)
    if (/\.json$/i.test(file)) handleJson(raw, rel, state, findings)
    else handleYaml(raw, rel, state, findings)
  }

  if (!state.provisionedFlux) {
    for (const dashboard of state.dashboards) {
      findings.push(makeFinding("DS001", dashboard, 1, "no InfluxDB-Flux datasource declared in scanned files"))
    }
  }

  return buildResult(findings, files.length)
}
