/**
 * Advisory message renderer: the frozen rubric, the tier header, and one <comments> block per file.
 */
import { isAgentMemo } from "./filter"
import type { CommentFinding, ScanTier } from "./types"

export const COMMENTS_PLACEHOLDER = "{{comments}}"

export const RUBRIC_TEMPLATE: string = `COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored, even if you receive it multiple times.
You MUST provide corresponding explanation or action for EACH occurrence of this message.
Ignoring this message or failing to respond appropriately is strictly prohibited.

PRIORITY-BASED ACTION GUIDELINES:

1. This is a comment/docstring that already existed before
	-> Explain to the user that this is an existing comment/docstring and proceed (justify it)

2. This is a newly written comment: but it's in given, when, then format
	-> Tell the user it's a BDD comment and proceed (justify it)
	-> Note: This applies to comments only, not docstrings

3. This is a newly written comment/docstring: but it's a necessary comment/docstring
	-> Tell the user why this comment/docstring is absolutely necessary and proceed (justify it)
	-> Examples of necessary comments: complex algorithms, security-related, performance optimization, regex, mathematical formulas
	-> Examples of necessary docstrings: public API documentation, complex module/class interfaces
	-> IMPORTANT: Most docstrings are unnecessary if the code is self-explanatory. Only keep truly essential ones.

4. This is a newly written comment/docstring: but it's an unnecessary comment/docstring
	-> Apologize to the user and remove the comment/docstring.
	-> Make the code itself clearer so it can be understood without comments/docstrings.
	-> For verbose docstrings: refactor code to be self-documenting instead of adding lengthy explanations.

MANDATORY REQUIREMENT: You must acknowledge this hook message and take one of the above actions.
Review in the above priority order and take the corresponding action EVERY TIME this appears.

REMINDER: These rules apply to ALL your future code, not just this specific edit. Always be deliberate and cautious when writing comments - only add them when absolutely necessary.
`

export interface RenderInput {
  readonly findings: readonly CommentFinding[]
  readonly filePath: string
  readonly tier: ScanTier
  readonly customPrompt?: string
  readonly agentMemoPrefixes?: readonly string[]
  readonly includeRubric?: boolean
}

const TIER_HEADERS: Readonly<Record<ScanTier, string>> = {
  ast: "Detected comments/docstrings:",
  regex: "Possible comments (heuristic):",
}

const MAX_FINDING_TEXT = 2048
const MAX_RENDERED_BYTES = 32 * 1024
const TRUNCATION_MARK = "…"

interface FileGroup {
  readonly file: string
  readonly findings: readonly CommentFinding[]
}

function byLineThenText(left: CommentFinding, right: CommentFinding): number {
  if (left.line !== right.line) return left.line - right.line
  if (left.text === right.text) return 0
  return left.text < right.text ? -1 : 1
}

function groupFindings(
  findings: readonly CommentFinding[],
  fallbackFile: string,
): readonly FileGroup[] {
  const order: string[] = []
  const groups = new Map<string, CommentFinding[]>()
  for (const finding of findings) {
    const file = finding.file || fallbackFile
    const bucket = groups.get(file)
    if (bucket) {
      bucket.push(finding)
      continue
    }
    groups.set(file, [finding])
    order.push(file)
  }
  return order.map((file) => ({ file, findings: [...(groups.get(file) ?? [])].sort(byLineThenText) }))
}


function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

function clampText(text: string): string {
  if (text.length <= MAX_FINDING_TEXT) return text
  return `${text.slice(0, MAX_FINDING_TEXT)}${TRUNCATION_MARK}`
}

function neutraliseTags(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<(?=\/?comments?)/gi, "< ")
    .replace(/(&#0*60;)(?=\/?comments?)/gi, "$1 ")
    .replace(/(&#x0*3c;)(?=\/?comments?)/gi, "$1 ")
}

function flattenControlChars(value: string): string {
  let output = ""
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    output += code < 0x20 || code === 0x7f ? " " : char
  }
  return output
}

function escapeAttribute(value: string): string {
  return flattenControlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderFindingsXml(findings: readonly CommentFinding[], filePath: string): string {
  const blocks: string[] = []
  let bytes = 0
  let emitted = 0
  let stopped = false
  for (const { file, findings: group } of groupFindings(findings, filePath)) {
    const header = `<comments file="${escapeAttribute(file)}">`
    if (stopped || bytes + byteLength(header) + 1 > MAX_RENDERED_BYTES) {
      stopped = true
      continue
    }
    const lines = [header]
    bytes += byteLength(header) + 1
    for (const finding of group) {
      const text = neutraliseTags(clampText(finding.text))
      const line = `\t<comment line-number="${finding.line}">${text}</comment>`
      if (bytes + byteLength(line) + 1 > MAX_RENDERED_BYTES) {
        stopped = true
        break
      }
      lines.push(line)
      bytes += byteLength(line) + 1
      emitted += 1
    }
    lines.push("</comments>")
    bytes += byteLength("</comments>") + 1
    blocks.push(`${lines.join("\n")}\n`)
  }
  const omitted = findings.length - emitted
  if (omitted > 0) blocks.push(`${TRUNCATION_MARK} (${omitted} more findings omitted)\n`)
  return blocks.join("")
}

function renderMemoListing(
  findings: readonly CommentFinding[],
  prefixes: readonly string[] | undefined,
): string {
  if (!prefixes || prefixes.length === 0) return ""
  const seen = new Set<string>()
  const lines: string[] = []
  for (const finding of [...findings].sort(byLineThenText)) {
    if (!isAgentMemo(finding.text, prefixes)) continue
    const key = `${finding.line}:${finding.text}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  - Line ${finding.line}: ${clampText(finding.text)}`)
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}

function renderSections(input: RenderInput): string {
  const listing = renderMemoListing(input.findings, input.agentMemoPrefixes)
  const xml = renderFindingsXml(input.findings, input.filePath)
  return `${TIER_HEADERS[input.tier]}\n${listing}${xml}`
}

function replaceOnce(haystack: string, needle: string, value: string): string | null {
  const index = haystack.indexOf(needle)
  if (index === -1) return null
  return haystack.slice(0, index) + value + haystack.slice(index + needle.length)
}

export function formatReport(input: RenderInput): string {
  if (input.findings.length === 0) return ""
  const sections = renderSections(input)
  if (input.includeRubric === false) return sections
  if (!input.customPrompt) return `${RUBRIC_TEMPLATE}\n${sections}`
  const replaced = replaceOnce(input.customPrompt, COMMENTS_PLACEHOLDER, sections)
  if (replaced !== null) return replaced
  return `${input.customPrompt}\n\n${sections}`
}
