import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { CAPABILITIES, EXCHANGE_IDS, RULE_CATALOG, SYMBOL_EXTENSIONS } from "./constants"
import type { SymbolFinding, SymbolSeverity, SymbolValidationResult } from "./types"

const SETTLE_RE = /[A-Z0-9]{2,}\/[A-Z0-9]{2,}:[A-Z0-9]{2,}/g
const NOSETTLE_RE = /[A-Z0-9]{2,}\/[A-Z0-9]{2,}(?![A-Za-z0-9:])/g
const QUOTED_RE = /(['"])([^'"\n]+)\1/g
const NATIVE_RE = /^[A-Z0-9]{3,}(?:USDT|USDC|BUSD|FDUSD|BTC|ETH)$/
const EXCHANGE_PREFIX_RE = /^[a-z0-9_]+:[A-Z0-9]+$/
const SYMBOL_SETTLE_FULL = /^[A-Z0-9]{2,}\/[A-Z0-9]{2,}:[A-Z0-9]{2,}$/
const SYMBOL_NOSETTLE_FULL = /^[A-Z0-9]{2,}\/[A-Z0-9]{2,}$/

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__"])

interface Occurrence {
  symbol: string
  kind: "settle" | "nosettle"
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function makeFinding(rule: string, file: string, line: number, symbol: string): SymbolFinding {
  const meta = RULE_CATALOG[rule]
  const severity: SymbolSeverity = meta?.severity ?? "warn"
  return {
    rule,
    severity,
    file,
    line,
    symbol,
    issue: meta?.issue ?? "Symbol convention violation.",
    fix: meta?.fix ?? "Use a unified symbol.",
  }
}

function extractOccurrences(line: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const match of line.matchAll(SETTLE_RE)) out.push({ symbol: match[0], kind: "settle" })
  for (const match of line.matchAll(NOSETTLE_RE)) out.push({ symbol: match[0], kind: "nosettle" })
  return out
}

function quotedValues(line: string): string[] {
  const out: string[] = []
  for (const match of line.matchAll(QUOTED_RE)) out.push(match[2])
  return out
}

function isExchangeIdOrNative(value: string): boolean {
  if (value.includes("/")) return false
  if (EXCHANGE_IDS.has(value.toLowerCase())) return true
  if (EXCHANGE_PREFIX_RE.test(value)) return true
  return NATIVE_RE.test(value)
}

export function validateText(
  text: string,
  file: string,
  marketSet: Set<string> | null,
): SymbolFinding[] {
  const lines = text.split("\n")
  const out: SymbolFinding[] = []
  const seen = new Set<string>()
  const push = (rule: string, line: number, symbol: string) => {
    const dedupeKey = `${rule}|${line}|${symbol}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    out.push(makeFinding(rule, file, line, symbol))
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const occurrence of extractOccurrences(line)) {
      if (occurrence.kind === "nosettle") push("MS001", i + 1, occurrence.symbol)
      if (marketSet && !marketSet.has(occurrence.symbol)) push("MS003", i + 1, occurrence.symbol)
    }
    for (const value of quotedValues(line)) {
      if (isExchangeIdOrNative(value)) push("MS002", i + 1, value)
    }
  }

  const handledKeys = new Set<string>()
  for (const capability of CAPABILITIES) {
    if (handledKeys.has(capability.key)) continue
    const callRe = new RegExp(`\\b${escapeRegExp(capability.call)}\\s*\\(`)
    if (!callRe.test(text)) continue
    const guardRe = new RegExp(`has\\s*\\[\\s*['"]${escapeRegExp(capability.key)}['"]`)
    if (guardRe.test(text)) continue
    handledKeys.add(capability.key)
    const lineIndex = lines.findIndex((line) => callRe.test(line))
    if (lineIndex !== -1) push("MS004", lineIndex + 1, capability.key)
  }

  return out
}

export function validateSymbols(symbols: string[], marketSet: Set<string> | null): SymbolFinding[] {
  const out: SymbolFinding[] = []
  for (const symbol of symbols) {
    if (SYMBOL_SETTLE_FULL.test(symbol)) {
      if (marketSet && !marketSet.has(symbol)) out.push(makeFinding("MS003", "<symbols>", 0, symbol))
      continue
    }
    if (SYMBOL_NOSETTLE_FULL.test(symbol)) {
      out.push(makeFinding("MS001", "<symbols>", 0, symbol))
      if (marketSet && !marketSet.has(symbol)) out.push(makeFinding("MS003", "<symbols>", 0, symbol))
      continue
    }
    if (isExchangeIdOrNative(symbol)) out.push(makeFinding("MS002", "<symbols>", 0, symbol))
  }
  return out
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
      } else if (entry.isFile() && SYMBOL_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
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

export function validatePath(opts: {
  base: string
  target: string
  marketSet: Set<string> | null
}): SymbolValidationResult {
  const files = collectFiles(opts.target)
  const findings: SymbolFinding[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    findings.push(...validateText(text, displayPath(opts.base, file), opts.marketSet))
  }
  return buildResult(findings, files.length)
}

export function buildResult(findings: SymbolFinding[], filesScanned: number): SymbolValidationResult {
  const byRule: Record<string, number> = {}
  let errors = 0
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1
    if (finding.severity === "error") errors += 1
  }
  const status: 0 | 1 | 2 = errors > 0 ? 2 : findings.length > 0 ? 1 : 0
  return {
    status,
    findings,
    summary: { filesScanned, total: findings.length, byRule },
  }
}
