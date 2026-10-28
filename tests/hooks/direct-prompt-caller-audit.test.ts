import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Audit: no direct `session.promptAsync` callers may remain outside the
 * explicit allowlist. All hook/plugin prompt injections must go through the
 * guarded wrapper in src/shared/model-suggestion-retry.ts
 * (promptWithModelSuggestionRetry / promptSyncWithModelSuggestionRetry),
 * which surfaces resolved `{ error }` envelopes as structured throws instead
 * of passing silently.
 *
 * Source of truth: live in-test scan of `src/` (pure-TS recursive walk,
 * no external process, no gitignored evidence file — CI-safe).
 */

// Files whose `session.promptAsync` occurrences are legitimate:
// - the guarded wrapper itself (internal call + type-level Parameters reference)
const ALLOWLISTED_FILES = new Set(["src/shared/model-suggestion-retry.ts"])

// A line counts as a *call* only when `.promptAsync` is followed by `(`.
// This excludes comments, docs, type-only mentions, and mock object keys.
const DIRECT_CALL_PATTERN = /\.promptAsync\s*\(/

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      collectTsFiles(abs, out)
    } else if (abs.endsWith(".ts") && !abs.endsWith(".test.ts")) {
      out.push(abs)
    }
  }
}

function scanPromptAsyncOccurrences(): string[] {
  const srcRoot = join(process.cwd(), "src")
  const files: string[] = []
  collectTsFiles(srcRoot, files)
  const lines: string[] = []
  for (const abs of files) {
    const rel = relative(process.cwd(), abs)
    const content = readFileSync(abs, "utf8")
    const split = content.split("\n")
    for (let i = 0; i < split.length; i++) {
      const text = split[i]
      if (text !== undefined && text.includes("session.promptAsync")) {
        lines.push(`${rel}:${i + 1}:${text.trim()}`)
      }
    }
  }
  return lines.sort()
}

describe("direct-prompt-caller-audit", () => {
  it("flags every non-allowlisted direct session.promptAsync caller", () => {
    //#given a live in-test scan of session.promptAsync occurrences in src/
    const lines = scanPromptAsyncOccurrences()
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
