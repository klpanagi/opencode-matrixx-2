/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "../..")

/**
 * Exact-path allowlist for documented, non-subagent uses of "background".
 *
 * Key a whole file (`path`) or a single line (`path:line`). Every entry must carry
 * the reason the match is legitimate; do not add a row for a real subagent argument.
 * A row survives only while it still suppresses a live `ARG_PATTERNS` hit: the
 * "every allowlist row still names a real, pattern-matching location" test below
 * fails when a row stops matching — the file is gone, the pinned line moved off the
 * hit, or the pattern changed — so an exemption cannot outlive the token it was
 * written for.
 *
 * `docs/` coverage lives in `tests/docs/no-stale-bg-claims.test.ts`, which walks
 * every `docs/**` markdown file. This scanner covers prompt sources and the runtime
 * strings tools hand back to a model, so `docs/` rows do not belong here — adding
 * `docs` to `SCAN_ROOTS` would collect zero `.ts` files and duplicate nothing that
 * scanner already checks.
 *
 * The tool-metadata test file is scanned because `SCAN_FILES` lists it; its two
 * matching lines are pinned below.
 */
export const BACKGROUND_ARG_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  [
    "src/shared/text/error-formatting.ts",
    "legacy `task`-tool error-args shape (ErrorContext.args); formatDetailedError still renders run_in_background, kept for the record",
  ],
  [
    "tests/features/tool-metadata-store/index.test.ts:39",
    "comment documenting the stored-metadata field on line 41; not a subagent argument",
  ],
  [
    "tests/features/tool-metadata-store/index.test.ts:41",
    "resolved tool metadata row (stored run_in_background, not a subagent argument)",
  ],
])

// Only the assignment form `background=` and the `run_in_background` token are matched; an object-literal `background: true` is out of scope by design (it does not exist in this tree). The bare slash-list form (e.g. `agent/background/load_skills`) is matched too, so a stale argument list cannot regrow.
const ARG_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'live "background=" argument', pattern: /background\s*=/i },
  { label: 'live "run_in_background" argument', pattern: /run_in_background/ },
  {
    label: 'background named in an argument list',
    pattern: /\bagent\s*\/\s*background\b|\bbackground\s*\/\s*load_skills\b/i,
  },
]

/**
 * Return human-readable violations for one prompt source file. Matches are line-scoped
 * so an allowlisted path (or path:line) can carry the documented use in place.
 */
export function findBackgroundArgClaims(relPath: string, text: string): string[] {
  const violations: string[] = []
  const lines = text.split("\n")

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const where = `${relPath}:${index + 1}`
    if (BACKGROUND_ARG_ALLOWLIST.has(relPath) || BACKGROUND_ARG_ALLOWLIST.has(where)) continue

    for (const { label, pattern } of ARG_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${where}: ${label}`)
      }
    }
  }

  return violations
}

const SCAN_ROOTS = [
  "src/agents/definitions",
  "src/agents/shared",
  "src/skills/builtin",
  "src/features/builtin-commands/templates",
  "src/features/plan-contract",
  "src/hooks",
  "src/tools",
] as const

const SCAN_FILES = [
  "src/shared/subagent/delegation-constants.ts",
  "src/shared/text/error-formatting.ts",
  "tests/features/tool-metadata-store/index.test.ts",
] as const

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"])

function walkTsFiles(root: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...walkTsFiles(absolute))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(absolute)
    }
  }

  return found
}

function relativeToRepo(absolute: string): string {
  return relative(REPO_ROOT, absolute)
}

function scannedGroups(): Array<{ root: string; files: string[] }> {
  return [
    ...SCAN_ROOTS.map((root) => ({ root, files: walkTsFiles(join(REPO_ROOT, root)) })),
    ...SCAN_FILES.map((file) => ({ root: file, files: [join(REPO_ROOT, file)] })),
  ]
}

/** Single source of truth for "what this scanner sees", shared by both drift tests. */
function collectViolations(group: { files: string[] }): string[] {
  return group.files.flatMap((file) =>
    findBackgroundArgClaims(relativeToRepo(file), readFileSync(file, "utf8")),
  )
}

describe("background-argument doctrine drift guard", () => {
  test("every scanned prompt root is free of background-argument claims", () => {
    //#given
    const groups = scannedGroups()
    for (const group of groups) {
      expect(existsSync(join(REPO_ROOT, group.root))).toBe(true)
      expect(group.files.length).toBeGreaterThan(0)
    }

    //#when
    const violations = groups.flatMap(collectViolations)

    //#then
    expect(violations).toEqual([])
  })

  test("a prompt root that can call subagent() carries zero background arguments", () => {
    //#given
    const groups = scannedGroups()
    let rootsWithSubagent = 0

    for (const group of groups) {
      const combined = group.files.map((file) => readFileSync(file, "utf8")).join("\n")
      if (!combined.includes("subagent(")) continue
      rootsWithSubagent += 1

      //#when
      const claims = collectViolations(group)

      //#then
      expect({ root: group.root, claims }).toEqual({ root: group.root, claims: [] })
    }

    expect(rootsWithSubagent).toBeGreaterThan(0)
  })

  test("every allowlist row still names a real, pattern-matching location", () => {
    //#given
    const rows = [...BACKGROUND_ARG_ALLOWLIST]
    expect(rows.length).toBeGreaterThan(0)

    //#when
    const staleRows = rows.filter(([key, reason]) => {
      const parsed = /^(.+\.ts)(?::(\d+))?$/.exec(key)
      if (!parsed) return true
      if (reason.trim() === "") return true

      const absolute = join(REPO_ROOT, parsed[1] ?? "")
      if (!existsSync(absolute)) return true

      const lines = readFileSync(absolute, "utf8").split("\n")
      const lineNumber = parsed[2]
      const scope = lineNumber ? [lines[Number(lineNumber) - 1] ?? ""] : lines
      return !scope.some((line) => ARG_PATTERNS.some(({ pattern }) => pattern.test(line)))
    })

    //#then
    expect(staleRows).toEqual([])
  })

  test("flags a background= argument on a scanned prompt path", () => {
    //#given
    const text = "subagent({ agent, prompt, background = true, description })"

    //#when
    const violations = findBackgroundArgClaims("src/agents/definitions/morpheus.ts", text)

    //#then
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('"background="')
  })

  test("flags a run_in_background argument on a scanned prompt path", () => {
    //#given
    const text = "Call subagent() with `run_in_background: true`."

    //#when
    const violations = findBackgroundArgClaims("src/skills/builtin/core/software-dev.ts", text)

    //#then
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('"run_in_background"')
  })

  test("allows the bare noun background", () => {
    //#given
    const text = "Write a background note after the wave completes."

    //#when
    const violations = findBackgroundArgClaims("src/agents/definitions/morpheus.ts", text)

    //#then
    expect(violations).toEqual([])
  })

  test("flags a bare slash-list that names background as an argument", () => {
    //#given
    const text = "Use the native subagent tool (with agent/background/load_skills)."

    //#when
    const violations = findBackgroundArgClaims("src/tools/task/task-create.ts", text)

    //#then
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("background named in an argument list")
  })

  test("keeps prose that only names the bare noun background clean", () => {
    //#given
    const text = "Record a background note in the handoff before the next wave starts."

    //#when
    const violations = findBackgroundArgClaims("src/agents/definitions/morpheus.ts", text)

    //#then
    expect(violations).toEqual([])
  })

  test("skips exact-path and path:line allowlist rows", () => {
    //#given
    const debugArgs = "run_in_background: boolean"
    const line41 = `${"\n".repeat(40)}metadata: { sessionId: "ses_sub", run_in_background: true }`

    //#when
    const fileAllowlisted = findBackgroundArgClaims("src/shared/text/error-formatting.ts", debugArgs)
    const lineAllowlisted = findBackgroundArgClaims(
      "tests/features/tool-metadata-store/index.test.ts",
      line41,
    )
    const notAllowlisted = findBackgroundArgClaims("src/agents/definitions/oracle.ts", line41)

    //#then
    expect(fileAllowlisted).toEqual([])
    expect(lineAllowlisted).toEqual([])
    expect(notAllowlisted).toHaveLength(1)
    expect(notAllowlisted[0]).toContain(":41:")
  })

  test("keeps the completion-message doctrine phrase in the migration docs", () => {
    //#given
    const docs = ["docs/native-subagent-migration.md", "src/features/AGENTS.md"]

    for (const doc of docs) {
      //#when
      const text = readFileSync(join(REPO_ROOT, doc), "utf8")

      //#then
      expect({ doc, hasPhrase: text.includes("completion message") }).toEqual({ doc, hasPhrase: true })
    }
  })
})
