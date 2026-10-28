import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Audit: no direct `session.promptAsync` callers may remain outside the
 * explicit allowlist. All hook/plugin prompt injections must go through the
 * guarded wrapper in src/shared/model-suggestion-retry.ts
 * (promptWithModelSuggestionRetry / promptSyncWithModelSuggestionRetry),
 * which surfaces resolved `{ error }` envelopes as structured throws instead
 * of passing silently.
 *
 * Source of truth: .matrixx/evidence/task-6-audit.txt
 * (captured via `rg -n "session.promptAsync" src/`).
 */

// Files whose `session.promptAsync` occurrences are legitimate:
// - the guarded wrapper itself (internal call + type-level Parameters reference)
const ALLOWLISTED_FILES = new Set(["src/shared/model-suggestion-retry.ts"])

// A line counts as a *call* only when `.promptAsync` is followed by `(`.
// This excludes comments, docs, type-only mentions, and mock object keys.
const DIRECT_CALL_PATTERN = /\.promptAsync\s*\(/

function parseAuditLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

describe("direct-prompt-caller-audit", () => {
  it("flags every non-allowlisted direct session.promptAsync caller", () => {
    //#given a captured rg audit of session.promptAsync occurrences in src/
    const auditPath = join(process.cwd(), ".matrixx/evidence/task-6-audit.txt")
    const raw = readFileSync(auditPath, "utf8")
    const lines = parseAuditLines(raw)
    expect(lines.length).toBeGreaterThan(0)

    //#when filtering to actual call sites outside the allowlist
    const violations = lines.filter((line) => {
      if (!DIRECT_CALL_PATTERN.test(line)) return false
      const file = line.split(":")[0] ?? ""
      return !ALLOWLISTED_FILES.has(file)
    })

    //#then no unguarded direct promptAsync caller remains
    expect(violations).toEqual([])
  })
})
