/**
 * Deterministic secret redaction for text that is about to be logged or echoed.
 *
 * The rules are ordered, pattern-based (no entropy heuristics) and idempotent:
 * running `redactSecrets` on its own output returns that output unchanged.
 */

interface RedactionRule {
  pattern: RegExp
  replacement: string
}

const REDACTION_RULES: readonly RedactionRule[] = [
  // Must run before the labelled-credential rule: keep the header name, drop the whole value.
  // `[^\r\n]*` consumes the entire header line (scheme + credential), not just the first token.
  { pattern: /Authorization:[^\r\n]*/gi, replacement: "Authorization: [REDACTED]" },
  { pattern: /(api[_-]?key|token|secret|password)(\s*[=:]\s*)\S+/gi, replacement: "$1$2[REDACTED]" },
  { pattern: /npm_[A-Za-z0-9]{20,}/g, replacement: "[REDACTED]" },
  { pattern: /sk-[A-Za-z0-9]{16,}/g, replacement: "[REDACTED]" },
  // AWS access key ID prefix.
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED]" },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: "[REDACTED]" },
  // PEM private key blocks collapse to a single marker.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED]",
  },
]

export function redactSecrets(text: string): string {
  let redacted = text
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement)
  }
  return redacted
}
