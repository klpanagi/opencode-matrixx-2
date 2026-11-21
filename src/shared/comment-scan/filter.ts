import { DEFAULT_MAX_FINDINGS } from "./constants"
import type { CommentFinding } from "./types"

export interface AllowList {
  readonly bddKeywords: RegExp
  readonly directives: readonly string[]
  readonly shebangs: readonly RegExp[]
  readonly agentMemoPrefixes: readonly string[]
}

export interface NormalizedFinding extends CommentFinding {
  readonly body: string
}

const LEADERS: readonly string[] = ["<!--", "//", "/*", "/", "--", "{-", "*", "#"]
const CLOSERS: readonly string[] = ["-->", "*/", "-}"]

function stripLeaders(line: string): string {
  let body = line.trimStart()
  for (;;) {
    const leader = LEADERS.find((candidate) => body.startsWith(candidate))
    if (!leader) return body
    body = body.slice(leader.length).trimStart()
  }
}

function stripClosers(text: string): string {
  let body = text.trimEnd()
  for (;;) {
    const closer = CLOSERS.find((candidate) => body.endsWith(candidate))
    if (!closer) return body
    body = body.slice(0, body.length - closer.length).trimEnd()
  }
}

export function normalizeCommentBody(text: string): string {
  const lines = stripClosers(text).split(/\r?\n/)
  return lines.map(stripLeaders).join(" ").replace(/\s+/g, " ").trim()
}

export function normalizeFinding(raw: CommentFinding): NormalizedFinding {
  return { ...raw, body: normalizeCommentBody(raw.text) }
}

/**
 * Allow-list regexes are single-shot patterns. Global (`/g`) regexes are unsupported because
 * `test` advances `lastIndex`, so a shared `/g` pattern would alternate between matches.
 */
function matches(regex: RegExp, text: string): boolean {
  return regex.test(text)
}

export function isAgentMemo(text: string, prefixes: readonly string[]): boolean {
  const body = normalizeCommentBody(text).toLowerCase()
  return prefixes.some((prefix) => body.startsWith(prefix.toLowerCase()))
}

function isShebang(finding: CommentFinding, allowList: AllowList): boolean {
  if (finding.line !== 1) return false
  const raw = finding.text.trimStart()
  return raw.startsWith("#!") || allowList.shebangs.some((regex) => matches(regex, raw))
}

function isKnown(finding: CommentFinding, allowList: AllowList): boolean {
  if (finding.isDocstring) return false
  if (isShebang(finding, allowList)) return true
  const body = normalizeCommentBody(finding.text)
  const lowered = body.toLowerCase()
  const isDirective = allowList.directives.some((directive) =>
    lowered.startsWith(directive.toLowerCase()),
  )
  if (isDirective) return true
  return matches(allowList.bddKeywords, body)
}

export function subtractKnown<T extends CommentFinding>(
  findings: readonly T[],
  allowList: AllowList,
): T[] {
  return findings.filter((finding) => !isKnown(finding, allowList))
}

const FALLBACK_BODY_LENGTH = 16

export function subtractCompareText(
  findings: readonly CommentFinding[],
  compareText: string | undefined,
): readonly CommentFinding[] {
  if (compareText === undefined || compareText === "") return findings
  const lines = new Set(compareText.split(/\r?\n/).map(normalizeCommentBody))
  let haystack: string | null = null
  return findings.filter((finding) => {
    const body = normalizeCommentBody(finding.text)
    if (lines.has(body)) return false
    if (body.length < FALLBACK_BODY_LENGTH) return true
    if (haystack === null) haystack = normalizeCommentBody(compareText)
    return !haystack.includes(body)
  })
}

export function dedupeFindings<T extends CommentFinding>(findings: readonly T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.text}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(finding)
  }
  return unique
}

export function capFindings<T extends CommentFinding>(
  findings: readonly T[],
  max: number = DEFAULT_MAX_FINDINGS,
): { findings: T[]; truncated: number } {
  const limit = Math.max(0, Math.trunc(max))
  const capped = findings.slice(0, limit)
  return { findings: capped, truncated: findings.length - capped.length }
}

export function applyFilters(
  raw: readonly CommentFinding[],
  allowList: AllowList,
  max?: number,
): { findings: CommentFinding[]; truncated: number } {
  const normalized = raw.map((finding) => normalizeFinding(finding))
  const known = subtractKnown(normalized, allowList)
  const unique = dedupeFindings(known)
  const capped = capFindings(unique, max)
  return {
    findings: capped.findings.map((finding) => {
      const { body, ...rest } = finding
      return rest
    }),
    truncated: capped.truncated,
  }
}
