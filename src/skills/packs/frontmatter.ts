/**
 * Parsing and sanitizing for third-party skill-pack content (R14).
 *
 * Pack text is untrusted input: frontmatter is parsed with a strict top-level
 * scalar allowlist (no YAML dependency, no nested structures), templates are
 * stripped of ANSI/control tokens and byte-capped, and every path-like name
 * must pass the kebab-case regex below before it reaches the filesystem.
 */

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  license?: string
  compatibility?: string
  argumentHint?: string
  body: string
}

export interface SanitizePackTemplateOptions {
  /** Byte cap for the sanitized template. Defaults to 262144 (256 KiB). */
  maxBytes?: number
  /** When set, every `CLAUDE_PLUGIN_ROOT` occurrence is replaced with this path. */
  coreSkillRoot?: string
}

export const DEFAULT_MAX_PACK_TEMPLATE_BYTES = 262144

export const CONTROL_TOKENS = [
  "<tool_use>",
  "</tool_use>",
  "<|im_start|>",
  "<|im_end|>",
  "</s>",
  "[INST]",
  "[/INST]",
] as const

export const SAFE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const FRONTMATTER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const INDENTED_LINE_PATTERN = /^[ \t]/
const BOM_PATTERN = /^\uFEFF/
const NEWLINE_PATTERN = /\r?\n/

// CSI sequences (colors, cursor movement) plus OSC sequences (titles, links).
// Built via RegExp() with escaped source so the control characters stay out of the literal.
const ESC = "\\u001B"
const BEL = "\\u0007"
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`,
  "g"
)

const CONTROL_TOKEN_PATTERN = new RegExp(
  CONTROL_TOKENS.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
)

const FRONTMATTER_DELIMITER = "---"
const CLAUDE_PLUGIN_ROOT = "CLAUDE_PLUGIN_ROOT"

export class UnsafeSkillNameError extends Error {
  readonly code = "UNSAFE_SKILL_NAME"

  constructor(readonly skillName: string) {
    super(`Unsafe skill name: ${JSON.stringify(skillName)}; expected ${SAFE_SKILL_NAME_PATTERN.source}`)
    this.name = "UnsafeSkillNameError"
  }
}

function unquote(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  return value
}

function parseTopLevelScalar(line: string): { key: string; value: string } | null {
  if (line.length === 0 || line.startsWith("#") || INDENTED_LINE_PATTERN.test(line)) return null
  const colonIndex = line.indexOf(":")
  if (colonIndex <= 0) return null
  const key = line.slice(0, colonIndex).trim()
  if (!FRONTMATTER_KEY_PATTERN.test(key)) return null
  const rawValue = line.slice(colonIndex + 1).trim()
  if (rawValue.length === 0) return null
  return { key, value: unquote(rawValue) }
}

/**
 * Parses only the leading `---` block of a skill document. Top-level scalars
 * only: indented content (nested `metadata:`) is ignored, and unknown keys are
 * tolerated but never returned.
 *
 * Returns `null` when the block is missing, unterminated, or lacks the
 * required `name` and `description` fields.
 */
export function parseSkillFrontmatter(raw: string): ParsedSkillFrontmatter | null {
  const lines = raw.replace(BOM_PATTERN, "").split(NEWLINE_PATTERN)
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) return null

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER
  )
  if (closingIndex === -1) return null

  const values = new Map<string, string>()
  for (const line of lines.slice(1, closingIndex)) {
    const scalar = parseTopLevelScalar(line)
    if (scalar) values.set(scalar.key, scalar.value)
  }

  const name = values.get("name")
  const description = values.get("description")
  if (!name || !description) return null

  const license = values.get("license")
  const compatibility = values.get("compatibility")
  const argumentHint = values.get("argument-hint") ?? values.get("argumentHint")

  return {
    name,
    description,
    ...(license !== undefined ? { license } : {}),
    ...(compatibility !== undefined ? { compatibility } : {}),
    ...(argumentHint !== undefined ? { argumentHint } : {}),
    body: lines.slice(closingIndex + 1).join("\n"),
  }
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) return DEFAULT_MAX_PACK_TEMPLATE_BYTES
  return Math.max(0, Math.floor(maxBytes))
}

/**
 * Sanitizes untrusted pack template text.
 *
 * Order: strip ANSI escapes, strip control tokens, replace `CLAUDE_PLUGIN_ROOT`
 * (only when `coreSkillRoot` is provided), then truncate at `maxBytes` with a
 * marker. The numeric second argument is a shorthand for `{ maxBytes }`.
 */
export function sanitizePackTemplate(
  text: string,
  options: SanitizePackTemplateOptions | number = {}
): string {
  const resolved = typeof options === "number" ? { maxBytes: options } : options
  const maxBytes = normalizeMaxBytes(resolved.maxBytes)

  let sanitized = text.replace(ANSI_ESCAPE_PATTERN, "").replace(CONTROL_TOKEN_PATTERN, "")
  if (resolved.coreSkillRoot !== undefined) {
    sanitized = sanitized.split(CLAUDE_PLUGIN_ROOT).join(resolved.coreSkillRoot)
  }

  if (Buffer.byteLength(sanitized, "utf8") <= maxBytes) return sanitized

  const truncated = Buffer.from(sanitized, "utf8").subarray(0, maxBytes).toString("utf8")
  return `${truncated}\n[truncated: skill template exceeded ${maxBytes} bytes]`
}

export function isSafeSkillName(name: unknown): name is string {
  return typeof name === "string" && SAFE_SKILL_NAME_PATTERN.test(name)
}

/** Rejects traversal, absolute paths, uppercase, underscores, and empty names. */
export function assertSafeSkillName(name: string): void {
  if (!isSafeSkillName(name)) throw new UnsafeSkillNameError(name)
}
