/**
 * Line-oriented heuristic tier: string literals are masked only within a single line, so a multi-line string or an escaped quote can hide or expose a leader.
 */
import type { RegexLeader } from "./constants"
import { DEFAULT_MAX_FINDINGS, MAX_FILE_BYTES, oversizeMessage, REGEX_LEADERS } from "./constants"
import { isRegexLanguage, resolveLanguage } from "./language"
import type { CommentFinding, RegexLanguage, ScanOptions, ScanSource } from "./types"

interface OpenBlock {
  readonly file: string
  readonly line: number
  readonly trailing: boolean
  readonly language: RegexLanguage
  readonly close: string
  readonly parts: string[]
}

interface LeaderHit {
  readonly leader: RegexLeader
  readonly index: number
}

function stringMask(line: string): readonly boolean[] {
  const mask = new Array<boolean>(line.length).fill(false)
  let quote: string | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? ""
    if (quote === null) {
      if (char === '"' || char === "'" || char === "`") {
        quote = char
        mask[index] = true
      }
      continue
    }
    mask[index] = true
    if (char === "\\") {
      if (index + 1 < line.length) {
        mask[index + 1] = true
        index += 1
      }
      continue
    }
    if (char === quote) quote = null
  }
  return mask
}

function findLeader(
  line: string,
  from: number,
  leaders: readonly RegexLeader[],
  mask: readonly boolean[],
): LeaderHit | null {
  let best: LeaderHit | null = null
  for (const leader of leaders) {
    let index = line.indexOf(leader.open, from)
    while (index !== -1 && mask[index] === true) {
      index = line.indexOf(leader.open, index + 1)
    }
    if (index === -1) continue
    if (best === null || index < best.index) best = { leader, index }
  }
  return best
}

function toFinding(file: string, line: number, text: string, trailing: boolean, language: RegexLanguage): CommentFinding {
  return { file, line, text, tier: "regex", isDocstring: false, trailing, language }
}

function scanLines(text: string, filePath: string, language: RegexLanguage, limit: number): CommentFinding[] {
  const leaders = REGEX_LEADERS[language]
  const findings: CommentFinding[] = []
  const lines = text.split(/\r?\n/)
  let open: OpenBlock | null = null

  for (let offset = 0; offset < lines.length; offset += 1) {
    if (findings.length >= limit) break
    const line = lines[offset] ?? ""
    const lineNumber = offset + 1
    const mask = stringMask(line)
    let cursor = 0

    while (cursor < line.length && findings.length < limit) {
      if (open !== null) {
        const closeIndex = line.indexOf(open.close, cursor)
        if (closeIndex === -1) {
          open.parts.push(line.slice(cursor))
          break
        }
        const end = closeIndex + open.close.length
        open.parts.push(line.slice(cursor, end))
        findings.push(toFinding(open.file, open.line, open.parts.join("\n").trim(), open.trailing, open.language))
        open = null
        cursor = end
        continue
      }

      const hit = findLeader(line, cursor, leaders, mask)
      if (hit === null) break
      const trailing = /\S/.test(line.slice(0, hit.index))

      if (hit.leader.close === null) {
        findings.push(toFinding(filePath, lineNumber, line.slice(hit.index).trim(), trailing, language))
        break
      }

      const afterOpen = hit.index + hit.leader.open.length
      const closeIndex = line.indexOf(hit.leader.close, afterOpen)
      if (closeIndex === -1) {
        open = {
          file: filePath,
          line: lineNumber,
          trailing,
          language,
          close: hit.leader.close,
          parts: [line.slice(hit.index)],
        }
        break
      }

      const end = closeIndex + hit.leader.close.length
      findings.push(toFinding(filePath, lineNumber, line.slice(hit.index, end).trim(), trailing, language))
      cursor = end
    }
  }

  if (open !== null && findings.length < limit) {
    findings.push(toFinding(open.file, open.line, open.parts.join("\n").trim(), open.trailing, open.language))
  }

  return findings
}

export function scanRegexText(text: string, filePath: string, language: RegexLanguage): CommentFinding[] {
  return scanLines(text, filePath, language, Number.POSITIVE_INFINITY)
}

export function scanRegexSources(
  sources: readonly ScanSource[],
  options?: ScanOptions,
  errors: string[] = [],
): CommentFinding[] {
  const limit = options?.maxFindings ?? DEFAULT_MAX_FINDINGS
  const findings: CommentFinding[] = []
  for (const source of sources) {
    if (findings.length >= limit) break
    const language = resolveLanguage(source.filePath)
    if (language === null || !isRegexLanguage(language)) continue
    const byteLength = Buffer.byteLength(source.text, "utf8")
    if (byteLength > MAX_FILE_BYTES) {
      errors.push(oversizeMessage(source.filePath, byteLength))
      continue
    }
    findings.push(...scanLines(source.text, source.filePath, language, limit - findings.length))
  }
  return findings
}
