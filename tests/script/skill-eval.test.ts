/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ExportedSkill,
  type QualityRow,
  type SkillCandidate,
  EXPECTED_SKILL_COUNT,
  UsageError,
  buildValidateArgs,
  collectBuiltinSkills,
  expandHomePath,
  formatSummaryTable,
  parseArgs,
  parseCatalogSummary,
  parseQualityReport,
  parseTiers,
  resolveDirNames,
  selectSkills,
  summarize,
  synthesizeSkillMd,
} from "../../script/skill-eval"

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const FULL_CHECKS = "schema,version,security,pii,license,code-integrity,unicode,quality,lint"

function candidate(overrides: Partial<SkillCandidate> & Pick<SkillCandidate, "name" | "exportKey" | "category">): SkillCandidate {
  return {
    description: `Use when testing ${overrides.name}`,
    template: "# body",
    sourceFile: `src/skills/builtin/${overrides.category}/${overrides.name}.ts`,
    ...overrides,
  }
}

function skill(overrides: Partial<ExportedSkill> & Pick<ExportedSkill, "name" | "dirName" | "category">): ExportedSkill {
  return {
    description: `Use when testing ${overrides.name}`,
    template: "# body",
    sourceFile: `src/skills/builtin/${overrides.category}/${overrides.name}.ts`,
    exportKey: `${overrides.name}Skill`,
    ...overrides,
  }
}

function row(skillName: string, score: number | null): QualityRow {
  return {
    skillName,
    score,
    grade: score === null ? null : "B",
    dimensions: {
      correctness: score,
      discoverability: score,
      reliability: score,
      efficiency: score,
    },
    estimatedTokens: score === null ? null : 1000,
    issues: [],
    reason: score === null ? "no report" : undefined,
  }
}

describe("synthesizeSkillMd", () => {
  test("emits exact frontmatter with version, metadata tags and JSON-quoted description", () => {
    //#given a skill whose description contains a colon-space and an em-dash
    const description = 'Use when parsing a "quoted": value — with an em-dash and more text'
    const target = skill({ name: "playwright", dirName: "playwright", category: "core", description, template: "# Body" })

    //#when synthesizing the SKILL.md
    const md = synthesizeSkillMd(target, { version: "9.9.9", author: "Tester <tester@example.com>" })

    //#then the document matches exactly, including quoted description and metadata block
    expect(md).toBe(
      [
        "---",
        'name: "playwright"',
        `description: ${JSON.stringify(description)}`,
        'version: "9.9.9"',
        "metadata:",
        '  author: "Tester <tester@example.com>"',
        "  tags:",
        '    - "core"',
        '    - "playwright"',
        "---",
        "# Body",
      ].join("\n"),
    )
  })

  test("defaults version and a Name <email@host> author", () => {
    //#given a skill with no options
    const target = skill({ name: "tdd-enforcer", dirName: "tdd-enforcer", category: "core" })

    //#when using default synthesis options
    const md = synthesizeSkillMd(target)

    //#then the default repo version and a format-compliant author are emitted
    expect(md).toContain('version: "1.0.0"')
    expect(md).toContain('  author: "klpanagi <klpanagi@users.noreply.github.com>"')
    expect(md).not.toContain('  author: "klpanagi"\n')
  })

  test("uses dirName for name and tags while preserving the original skill name in the description", () => {
    //#given a renamed duplicate skill
    const target = skill({
      name: "playwright",
      dirName: "playwright-cli",
      category: "core",
      exportKey: "playwrightCliSkill",
      template: "# CLI",
    })

    //#when synthesizing
    const md = synthesizeSkillMd(target)

    //#then name is dirName and tags are [category, dirName]
    expect(md).toContain('name: "playwright-cli"')
    expect(md).toContain('    - "core"\n    - "playwright-cli"')
  })

  test("emits allowed-tools as a quoted string only when allowedTools is non-empty", () => {
    //#given two skills, one with allowed tools and one without
    const withTools = skill({ name: "git-master", dirName: "git-master", category: "core", allowedTools: ["Read", "Bash"] })
    const withoutTools = skill({ name: "git-master", dirName: "git-master", category: "core", allowedTools: [] })

    //#when synthesizing both
    const withMd = synthesizeSkillMd(withTools)
    const withoutMd = synthesizeSkillMd(withoutTools)

    //#then only the populated one carries the quoted string field
    expect(withMd).toContain('allowed-tools: "Read, Bash"')
    expect(withoutMd).not.toContain("allowed-tools:")
  })

  test("never emits license, compatibility, metadata.id or harness-specific fields", () => {
    //#given a skill carrying harness-only metadata
    const target = skill({
      name: "docker-master",
      dirName: "docker-master",
      category: "core",
      allowedTools: ["Bash"],
    })

    //#when synthesizing
    const md = synthesizeSkillMd(target)

    //#then none of the redundant keys appear
    for (const forbidden of ["license:", "compatibility:", "metadata.id:", "mcpConfig:", "agent:", "model:", "subtask:", "argumentHint:"]) {
      expect(md).not.toContain(forbidden)
    }
  })

  test("keeps frontmatter delimiters balanced", () => {
    //#given a minimal skill
    const target = skill({ name: "rp-research", dirName: "rp-research", category: "core" })

    //#when synthesizing
    const md = synthesizeSkillMd(target)

    //#then the document opens and closes a single frontmatter block
    const lines = md.split("\n")
    expect(lines[0]).toBe("---")
    expect(lines.indexOf("---", 1)).toBeGreaterThan(1)
  })
})

describe("resolveDirNames", () => {
  test("disambiguates the two same-named playwright skills", () => {
    //#given two candidates sharing the name playwright
    const candidates: SkillCandidate[] = [
      candidate({ name: "playwright", exportKey: "playwrightSkill", category: "core" }),
      candidate({ name: "playwright", exportKey: "playwrightCliSkill", category: "core" }),
    ]

    //#when resolving directory names
    const resolved = resolveDirNames(candidates)

    //#then both keep distinct kebab-case directories
    expect(resolved.map((entry) => entry.dirName).sort()).toEqual(["playwright", "playwright-cli"])
    for (const entry of resolved) {
      expect(entry.dirName).toMatch(KEBAB_CASE)
    }
  })

  test("uses the skill name as the directory name when it is unique", () => {
    //#given a single candidate
    const resolved = resolveDirNames([candidate({ name: "zeromq-core", exportKey: "zeromqCoreSkill", category: "zeromq" })])

    //#when resolving
    //#then the directory equals the name
    expect(resolved[0]?.dirName).toBe("zeromq-core")
  })

  test("throws on an invalid kebab-case name", () => {
    //#given a candidate with an underscore in its name
    const candidates = [candidate({ name: "Bad_Name", exportKey: "badNameSkill", category: "core" })]

    //#when resolving
    //#then it fails with a descriptive kebab-case error
    expect(() => resolveDirNames(candidates)).toThrow(/kebab-case/i)
  })

  test("throws when a derived directory name collides with a unique skill name", () => {
    //#given a unique playwright-cli skill and a playwright duplicate pair
    const candidates: SkillCandidate[] = [
      candidate({ name: "playwright-cli", exportKey: "playwrightCliStandaloneSkill", category: "core" }),
      candidate({ name: "playwright", exportKey: "playwrightSkill", category: "core" }),
      candidate({ name: "playwright", exportKey: "playwrightCliSkill", category: "core" }),
    ]

    //#when resolving directory names
    //#then the duplicate error is surfaced
    expect(() => resolveDirNames(candidates)).toThrow(/duplicate|unique/i)
  })

  test("throws on an empty candidate list", () => {
    //#given no candidates
    //#when resolving
    //#then resolution refuses to produce an empty catalog
    expect(() => resolveDirNames([])).toThrow(/no skills/i)
  })
})

describe("buildValidateArgs", () => {
  test("defaults to the non-scanner checks allowlist and the uvx runner", () => {
    //#given skillevaluator is not installed on PATH
    const args = buildValidateArgs({
      catalogDir: "/tmp/out/catalog",
      reportsDir: "/tmp/out/reports",
      tiers: "1",
      deep: false,
      evaluatorOnPath: false,
    })

    //#when building the validate invocation
    //#then uvx prefixes the command, the catalog is the target and reports stay outside it
    expect(args.slice(0, 4)).toEqual(["uvx", "--python", "3.13", "skillevaluator"])
    expect(args[args.indexOf("validate") + 1]).toBe("/tmp/out/catalog")
    expect(args.slice(args.indexOf("--tiers"), args.indexOf("--tiers") + 2)).toEqual(["--tiers", "1"])
    expect(args[args.indexOf("-o") + 1]).toBe("/tmp/out/reports")
    expect(args.slice(args.indexOf("--checks"), args.indexOf("--checks") + 2)).toEqual([
      "--checks",
      "schema,version,quality,lint,pii,license,unicode",
    ])
    expect(args).not.toContain("--skip")
    expect(args).not.toContain("--workers")
  })

  test("uses the full checks allowlist in deep mode with the local runner", () => {
    //#given deep mode is requested
    const args = buildValidateArgs({
      catalogDir: "/tmp/out/catalog",
      reportsDir: "/tmp/out/reports",
      tiers: "1,2,3",
      deep: true,
      evaluatorOnPath: true,
    })

    //#when building the validate invocation
    //#then the bare runner is used and scanner-backed checks are re-enabled
    expect(args[0]).toBe("skillevaluator")
    expect(args.slice(args.indexOf("--checks"), args.indexOf("--checks") + 2)).toEqual(["--checks", FULL_CHECKS])
    expect(args).not.toContain("--skip")
    expect(args.slice(args.indexOf("--tiers"), args.indexOf("--tiers") + 2)).toEqual(["--tiers", "1,2,3"])
  })

  test("passes --workers through when requested", () => {
    //#given an explicit worker count
    const args = buildValidateArgs({
      catalogDir: "/tmp/out/catalog",
      reportsDir: "/tmp/out/reports",
      tiers: "1",
      deep: false,
      evaluatorOnPath: true,
      workers: 4,
    })

    //#when building the invocation
    //#then the evaluator receives its own parallel flag
    expect(args.slice(args.indexOf("--workers"), args.indexOf("--workers") + 2)).toEqual(["--workers", "4"])
  })
})

describe("parseQualityReport", () => {
  test("reads the per-skill entry from the quality_summary envelope", () => {
    //#given a real skillevaluator quality envelope with two evaluated skills
    const envelope = {
      version: "0.9.0",
      target_path: "skills/git-master",
      overall_passed: true,
      total_validators: 12,
      severity_counts: { error: 0, warning: 1, info: 2 },
      skills: [{ name: "git-master", passed: true, issue_count: 9 }],
      quality_summary: [
        {
          overall_score: 91.5,
          grade: "A",
          skill_type: "guide-only",
          skill_name: "git-master",
          dimensions: {
            correctness: { score: 100.0, weight: 0.35, issues_count: 0, issues: [] },
            discoverability: {
              score: 90.0,
              weight: 0.25,
              issues_count: 1,
              issues: [
                { severity: "info", message: "SKILL_SPEC recommended field missing: 'version'", suggestion: "add version", deduction: 5 },
              ],
            },
            reliability: {
              score: 85.0,
              weight: 0.25,
              issues_count: 1,
              issues: [
                { severity: "warning", message: "Description length outside recommended range", suggestion: "shorten", deduction: 10 },
              ],
            },
            efficiency: { score: 85.0, weight: 0.15, issues_count: 0, issues: [] },
          },
          metrics: { estimated_tokens: 7441, recommended_max_tokens: 5000, has_frontmatter: true },
        },
        {
          overall_score: 55.0,
          grade: "F",
          skill_type: "guide-only",
          skill_name: "other",
          dimensions: {
            correctness: { score: 50.0, weight: 0.35, issues_count: 0, issues: [] },
            discoverability: { score: 60.0, weight: 0.25, issues_count: 0, issues: [] },
            reliability: { score: 55.0, weight: 0.25, issues_count: 0, issues: [] },
            efficiency: { score: 55.0, weight: 0.15, issues_count: 0, issues: [] },
          },
          metrics: { estimated_tokens: 100, recommended_max_tokens: 5000, has_frontmatter: true },
        },
      ],
    }

    //#when selecting by skill name
    const parsed = parseQualityReport(envelope, "other")

    //#then the matching entry is returned with dimensions, tokens and issue messages
    expect(parsed.skillName).toBe("other")
    expect(parsed.score).toBe(55)
    expect(parsed.grade).toBe("F")
    expect(parsed.dimensions).toEqual({ correctness: 50, discoverability: 60, reliability: 55, efficiency: 55 })
    expect(parsed.estimatedTokens).toBe(100)
    expect(parsed.issues).toEqual([])
  })

  test("collects issue messages for the frequency report", () => {
    //#given an envelope with issue messages in two dimensions
    const envelope = {
      quality_summary: [
        {
          overall_score: 91.5,
          grade: "A",
          skill_name: "git-master",
          dimensions: {
            correctness: { score: 100, issues: [] },
            discoverability: { score: 90, issues: [{ message: "missing version", deduction: 5 }] },
            reliability: { score: 85, issues: [{ message: "long description", deduction: 10 }] },
            efficiency: { score: 85, issues: [] },
          },
          metrics: { estimated_tokens: 7441 },
        },
      ],
    }

    //#when parsing
    const parsed = parseQualityReport(envelope, "git-master")

    //#then all issue messages are surfaced once
    expect(parsed.issues).toEqual(["missing version", "long description"])
    expect(parsed.score).toBe(91.5)
  })

  test("returns a null score for an empty quality_summary array", () => {
    //#given an envelope whose quality_summary is empty
    const parsed = parseQualityReport({ quality_summary: [] }, "git-master")

    //#when parsing
    //#then no score is fabricated and a reason is recorded
    expect(parsed.score).toBeNull()
    expect(parsed.reason).toMatch(/empty/i)
  })

  test("falls back to a flat legacy report shape", () => {
    //#given an older flat QualityScoreResult
    const flat = {
      overall_score: 84.5,
      grade: "B",
      skill_name: "legacy",
      dimensions: {
        correctness: { score: 0.0 },
        discoverability: { score: 0.9 },
        reliability: { score: 0.8 },
        efficiency: { score: 0.7 },
      },
      metrics: { estimated_tokens: 0 },
    }

    //#when parsing
    const parsed = parseQualityReport(flat, "legacy")

    //#then the flat payload is accepted
    expect(parsed.score).toBe(84.5)
    expect(parsed.grade).toBe("B")
    expect(parsed.dimensions).toEqual({ correctness: 0, discoverability: 90, reliability: 80, efficiency: 70 })
  })

  test("returns a null score for non-JSON text without throwing", () => {
    //#given raw non-JSON text
    //#when parsing
    const parsed = parseQualityReport("not json at all", "git-master")

    //#then a reason replaces the score
    expect(parsed.score).toBeNull()
    expect(parsed.reason).toBeTruthy()
    expect(parsed.issues).toEqual([])
  })

  test("returns a null score for missing payloads without throwing", () => {
    //#given undefined and an object without scores
    //#when parsing both
    const undefinedParsed = parseQualityReport(undefined, "x")
    const emptyParsed = parseQualityReport({ quality_summary: [{ skill_name: "x" }] }, "x")

    //#then neither throws and both are unscored
    expect(undefinedParsed.score).toBeNull()
    expect(emptyParsed.score).toBeNull()
    expect(emptyParsed.reason).toBeTruthy()
  })
})

describe("parseCatalogSummary", () => {
  test("reads totals and per-skill pass/fail from catalog-summary.json", () => {
    //#given a real folder-mode catalog summary
    const payload = {
      total: 2,
      passed: 1,
      failed: 1,
      overall_passed: false,
      reports_root: "reports",
      summary_path: "catalog-summary.json",
      severity_totals: { critical: 0, high: 1, medium: 6, low: 11 },
      skills: [
        {
          name: "agent-browser",
          passed: false,
          report_dir: "agent-browser",
          reason: "validation failed",
          json_report: "skillevaluator-output-20261114022245.json",
          overall_passed: false,
          overall_status: "failed",
          incomplete_scans: ["skillspector"],
          severity_counts: { critical: 0, high: 1, medium: 4, low: 5 },
        },
        {
          name: "bdd-backend",
          passed: true,
          report_dir: "bdd-backend",
          reason: null,
          json_report: "skillevaluator-output-20261114022248.json",
          overall_passed: true,
          overall_status: "passed",
          incomplete_scans: [],
          severity_counts: { critical: 0, high: 0, medium: 2, low: 6 },
        },
      ],
      generated_at: "2026-11-14T02:22:48.466341+00:00",
    }

    //#when parsing
    const summary = parseCatalogSummary(payload)

    //#then totals, severities and per-skill results are available
    expect(summary?.total).toBe(2)
    expect(summary?.passed).toBe(1)
    expect(summary?.failed).toBe(1)
    expect(summary?.overallPassed).toBe(false)
    expect(summary?.severityTotals).toEqual({ critical: 0, high: 1, medium: 6, low: 11 })
    expect(summary?.skills.map((entry) => entry.passed)).toEqual([false, true])
    expect(summary?.skills[0]?.severityCounts).toEqual({ critical: 0, high: 1, medium: 4, low: 5 })
  })

  test("returns null for a malformed summary without throwing", () => {
    //#given payloads without a usable skills array
    //#when parsing
    const stringPayload = parseCatalogSummary("not json")
    const emptySkills = parseCatalogSummary({ total: 0, skills: [] })
    const noSkills = parseCatalogSummary({ total: 2 })

    //#then all are rejected
    expect(stringPayload).toBeNull()
    expect(emptySkills).toBeNull()
    expect(noSkills).toBeNull()
  })
})

describe("formatSummaryTable", () => {
  test("sorts ascending by score with unscored rows last and reports below-70 count", () => {
    //#given rows out of order including one unscored row
    const rows = [row("beta", 84), row("missing", null), row("worst", 55), row("best", 92), row("fail", 60)]

    //#when formatting the summary table
    const table = formatSummaryTable(rows)
    const lines = table.split("\n")

    //#then the table header exists, rows ascend, and the counts are reported
    expect(table).toContain("| skill | score | grade | correctness | discoverability | reliability | efficiency |")
    const order = ["worst", "fail", "beta", "best", "missing"].map((name) => lines.findIndex((line) => line.startsWith(`| ${name} `)))
    expect(order.every((index) => index > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(table).toMatch(/below 70: 2/)
    expect(table).toMatch(/passing \(>=70\): 2/)
    expect(table).toMatch(/mean: 72\.8/)
  })

  test("renders n/a for unscored dimensions", () => {
    //#given a single unscored row
    //#when formatting
    const table = formatSummaryTable([row("broken", null)])

    //#then unscored cells show n/a
    expect(table).toContain("| broken | n/a | n/a | n/a | n/a | n/a | n/a |")
  })

  test("handles an empty catalog without dividing by zero", () => {
    //#given no rows
    //#when formatting
    const table = formatSummaryTable([])

    //#then the table still renders with zeroed counts
    expect(table).toContain("below 70: 0")
    expect(table).not.toContain("NaN")
  })
})

describe("parseArgs", () => {
  test("defaults to eval with the standard output directory", () => {
    //#given no arguments
    const options = parseArgs([])

    //#when parsed
    //#then eval defaults apply
    expect(options.command).toBe("eval")
    expect(options.outDir).toBe(".matrixx/skill-eval")
    expect(options.tiers).toBe("1")
    expect(options.concurrency).toBe(4)
    expect(options.deep).toBe(false)
  })

  test("parses export with flags", () => {
    //#given an export invocation with overrides
    const options = parseArgs(["export", "--out", "/tmp/catalog", "--only", "git-master,zeromq-core", "--limit", "2"])

    //#when parsed
    //#then every flag lands on the option object
    expect(options.command).toBe("export")
    expect(options.outDir).toBe("/tmp/catalog")
    expect(options.only).toEqual(["git-master", "zeromq-core"])
    expect(options.limit).toBe(2)
  })

  test("parses --verbose", () => {
    //#given a verbose run
    //#when parsed
    //#then the flag is exposed for inconclusive skill listings
    expect(parseArgs(["--verbose"]).verbose).toBe(true)
    expect(parseArgs([]).verbose).toBe(false)
  })

  test("parses the evaluator worker count", () => {
    //#given a --workers flag
    const options = parseArgs(["--workers", "4"])

    //#when parsed
    //#then it is exposed for buildValidateArgs
    expect(options.workers).toBe(4)
  })

  test("throws UsageError on an unknown flag", () => {
    //#given an unrecognized flag
    //#when parsed
    //#then a usage error is raised
    expect(() => parseArgs(["--nope"])).toThrow(UsageError)
  })

  test("throws UsageError on a non-numeric limit", () => {
    //#given a bad limit value
    //#when parsed
    //#then a usage error is raised
    expect(() => parseArgs(["--limit", "many"])).toThrow(UsageError)
  })
})

describe("collectBuiltinSkills", () => {
  test("enumerates exactly 70 skills with unique kebab-case dirs and non-empty templates", async () => {
    //#given the repository root
    const root = new URL("../..", import.meta.url).pathname

    //#when collecting builtin skills
    const skills = await collectBuiltinSkills(root)

    //#then the catalog is complete, unique and fully materialized
    expect(skills.length).toBe(70)
    const dirNames = skills.map((entry) => entry.dirName)
    expect(new Set(dirNames).size).toBe(dirNames.length)
    for (const entry of skills) {
      expect(entry.dirName).toMatch(KEBAB_CASE)
      expect(entry.template.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(["bdd", "core", "dsl", "frontend", "market-data", "security", "zeromq"]).toContain(entry.category)
    }
  })

  test("keeps both playwright skills under distinct directory names", async () => {
    //#given the repository root
    const root = new URL("../..", import.meta.url).pathname

    //#when collecting
    const skills = await collectBuiltinSkills(root)

    //#then both same-named playwright entries survive as playwright and playwright-cli
    const playwrights = skills.filter((entry) => entry.name === "playwright")
    expect(playwrights.length).toBe(2)
    expect(playwrights.map((entry) => entry.dirName).sort()).toEqual(["playwright", "playwright-cli"])
    const templates = playwrights.map((entry) => entry.template.length).sort((a, b) => a - b)
    expect(templates[0]).toBeLessThan(templates[1] ?? 0)
  })

  test("includes multi-file skills defined in nested index.ts while skipping barrels", async () => {
    //#given the repository root
    const root = new URL("../..", import.meta.url).pathname

    //#when collecting
    const skills = await collectBuiltinSkills(root)

    //#then nested-index skills are present with content, and no barrel leaks an index skill
    const dirNames = skills.map((entry) => entry.dirName)
    expect(dirNames).not.toContain("index")
    for (const name of ["docker-master", "git-master"]) {
      const entry = skills.find((skillEntry) => skillEntry.name === name)
      expect(entry).toBeDefined()
      expect(entry?.template.length).toBeGreaterThan(0)
      expect(entry?.category).toBe("core")
    }
    expect(dirNames).toContain("playwright")
    expect(dirNames).toContain("playwright-cli")
  })
})


describe("parseTiers", () => {
  test("normalizes and dedupes tier selections", () => {
    //#given unordered and duplicated tiers
    //#when parsing
    //#then tier 1 leads and duplicates collapse
    expect(parseTiers("3,1")).toBe("1,3")
    expect(parseTiers("1,2,2")).toBe("1,2")
  })

  test("rejects selections without tier 1", () => {
    //#given a selection that omits the mandatory tier
    //#when parsing
    //#then a usage error explains tier 1 is required
    expect(() => parseTiers("2")).toThrow(/tier 1/i)
    expect(() => parseTiers("2,3")).toThrow(UsageError)
  })

  test("rejects unknown tiers", () => {
    //#given values outside 1,2,3
    //#when parsing
    //#then a usage error is raised
    expect(() => parseTiers("foo")).toThrow(UsageError)
    expect(() => parseTiers("1,4")).toThrow(UsageError)
  })
})

describe("expandHomePath", () => {
  test("expands a leading tilde when HOME is known", () => {
    //#given a tilde prefixed path and a HOME value
    //#when expanding
    //#then the path is joined under HOME
    expect(expandHomePath("~/catalog", "/home/u")).toBe("/home/u/catalog")
    expect(expandHomePath("~", "/home/u")).toBe("/home/u")
  })

  test("leaves absolute paths untouched", () => {
    //#given an absolute path
    //#when expanding
    //#then it is not rewritten
    expect(expandHomePath("/abs", "/home/u")).toBe("/abs")
  })

  test("rejects a tilde path when HOME is not set", () => {
    //#given no HOME value
    //#when expanding a tilde path
    //#then it fails instead of becoming a literal cwd-relative directory
    expect(() => expandHomePath("~/x", undefined)).toThrow(/HOME is not set/)
    expect(() => expandHomePath("~", undefined)).toThrow(UsageError)
  })

  test("treats empty and whitespace-only HOME as unset", () => {
    //#given HOME is set but blank
    //#when expanding a tilde path
    //#then the same usage error is raised before any directory is created
    expect(() => expandHomePath("~/x", "")).toThrow(/HOME is not set/)
    expect(() => expandHomePath("~/x", "   ")).toThrow(UsageError)
    expect(() => expandHomePath("~", "")).toThrow(/HOME is not set/)
  })
})

describe("parseArgs value handling", () => {
  test("rejects a following flag as a missing value", () => {
    //#given --out directly followed by another flag
    //#when parsed
    //#then the value is rejected instead of consumed
    expect(() => parseArgs(["--out", "--json"])).toThrow(/missing value for --out/)
  })

  test("normalizes --tiers through parseTiers", () => {
    //#given an unordered tier list
    //#when parsed
    //#then the stored tiers are normalized
    expect(parseArgs(["--tiers", "3,1"]).tiers).toBe("1,3")
  })

  test("expands a tilde output directory", () => {
    //#given a tilde prefixed --out value
    //#when parsed with a known HOME
    //#then the option holds the expanded path
    const home = process.env.HOME
    expect(parseArgs(["--out", "~/catalog"]).outDir).toBe(expandHomePath("~/catalog", home))
  })

  test("rejects --out ~ when HOME is not set", () => {
    //#given no HOME value
    //#when parsing a tilde output directory
    //#then a usage error is raised
    expect(() => parseArgs(["--out", "~/catalog"], null)).toThrow(/HOME is not set/)
  })

  test("rejects --out ~ when HOME is empty or whitespace-only", () => {
    //#given a blank HOME value
    //#when parsing a tilde output directory
    //#then a usage error is raised before any filesystem work
    expect(() => parseArgs(["--out", "~/catalog"], "")).toThrow(/HOME is not set/)
    expect(() => parseArgs(["--out", "~/catalog"], "   ")).toThrow(/HOME is not set/)
  })
})

describe("selectSkills", () => {
  const playwrightMcp = skill({ name: "playwright", dirName: "playwright", category: "core" })
  const playwrightCli = skill({
    name: "playwright",
    dirName: "playwright-cli",
    category: "core",
    exportKey: "playwrightCliSkill",
  })
  const zeromq = skill({ name: "zeromq-core", dirName: "zeromq-core", category: "zeromq" })
  const catalog = [playwrightMcp, playwrightCli, zeromq]

  test("prefers a unique dirName match over the shared skill name", () => {
    //#given --only playwright where one dirName and two names match
    //#when selecting
    //#then only the dirName match is returned
    expect(selectSkills(catalog, parseArgs(["--only", "playwright"]))).toEqual([playwrightMcp])
    expect(selectSkills(catalog, parseArgs(["--only", "playwright-cli"]))).toEqual([playwrightCli])
  })

  test("falls back to the skill name when no dirName matches", () => {
    //#given --only playwright when the dirName does not exist
    //#when selecting against a catalog without a playwright dirName
    //#then both name matches are returned
    const withoutDir = [playwrightMcp, playwrightCli]
    expect(selectSkills(withoutDir, parseArgs(["--only", "playwright"]))).toEqual([playwrightMcp])
  })

  test("errors listing unmatched --only entries", () => {
    //#given a typo alongside a valid entry
    //#when selecting
    //#then the typo is named in the usage error
    expect(() => selectSkills(catalog, parseArgs(["--only", "nope,zeromq-core"]))).toThrow(/nope/)
  })
})

describe("report normalization and legends", () => {
  test("normalizes an overall score supplied as a ratio", () => {
    //#given a flat report whose overall score is 0..1
    //#when parsing
    //#then the score is scaled like dimension scores
    const parsed = parseQualityReport(
      {
        overall_score: 0.915,
        grade: "A",
        skill_name: "x",
        dimensions: {
          correctness: { score: 1.0 },
          discoverability: { score: 0.9 },
          reliability: { score: 0.8 },
          efficiency: { score: 0.7 },
        },
      },
      "x",
    )
    expect(parsed.score).toBe(91.5)
    expect(parsed.dimensions).toEqual({ correctness: 100, discoverability: 90, reliability: 80, efficiency: 70 })
  })

  test("retains incomplete scans and overall status per catalog skill", () => {
    //#given a catalog summary from a folder-mode run with an incomplete scanner
    const summary = parseCatalogSummary({
      total: 1,
      passed: 0,
      failed: 1,
      overall_passed: false,
      skills: [
        {
          name: "security-core",
          passed: false,
          overall_status: "incomplete",
          incomplete_scans: ["skillspector"],
          severity_counts: { critical: 0, high: 0 },
        },
      ],
    })

    //#when parsed
    //#then the scanner gap is preserved for the summary and JSON output
    expect(summary?.skills[0]?.incompleteScans).toEqual(["skillspector"])
    expect(summary?.skills[0]?.overallStatus).toBe("incomplete")
  })

  test("explains n/a cells with a legend", () => {
    //#given an unscored row
    //#when formatting
    //#then the table footer explains n/a
    expect(formatSummaryTable([row("broken", null)])).toContain("n/a = unscored")
  })

  test("summarize aggregates pass/below/mean exactly once", () => {
    //#given a mixed row set
    const rows = [row("a", 84), row("b", 55), row("c", null), row("d", 60), row("e", 92)]

    //#when summarizing
    //#then counts and mean match the table presentation
    expect(summarize(rows)).toEqual({ scored: 4, passing: 2, belowThreshold: 2, mean: 72.8 })
    expect(summarize([])).toEqual({ scored: 0, passing: 0, belowThreshold: 0, mean: null })
  })

  test("pins the expected skill count constant", () => {
    //#given the catalog guard constant
    //#when compared to the repository
    //#then it matches the audited count
    expect(EXPECTED_SKILL_COUNT).toBe(70)
  })
})

const STUB_EVALUATOR = `#!/bin/sh
set -eu
cmd="$1"
shift
out=""
target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -r|--tiers|--checks|--workers) shift 2 ;;
    *) target="$1"; shift ;;
  esac
done
mode="\${STUB_MODE:-pass}"
mkdir -p "$out"
if [ "$cmd" = "validate" ]; then
  if [ "$mode" = "silent" ]; then
    exit 0
  fi
  if [ "$mode" = "malformed" ]; then
    printf '%s\n' '{not valid json' > "$out/catalog-summary.json"
    exit 1
  fi
  if [ "$mode" = "incomplete" ] || [ "$mode" = "incomplete-crash" ]; then
    cat > "$out/catalog-summary.json" <<EOF
{"total":1,"passed":0,"failed":1,"overall_passed":false,"severity_totals":{"critical":0,"high":0,"medium":0,"low":0},"skills":[{"name":"git-master","passed":false,"reason":"incomplete","overall_status":"incomplete","incomplete_scans":["skillspector"],"severity_counts":{"critical":0,"high":0,"medium":0,"low":0}}]}
EOF
    exit 1
  fi
  if [ "$mode" = "real-failure" ]; then
    cat > "$out/catalog-summary.json" <<EOF
{"total":1,"passed":0,"failed":1,"overall_passed":false,"severity_totals":{"critical":0,"high":1,"medium":0,"low":0},"skills":[{"name":"git-master","passed":false,"reason":"validation failed","overall_status":"failed","incomplete_scans":[],"severity_counts":{"critical":0,"high":1,"medium":0,"low":0}}]}
EOF
    exit 1
  fi
  cat > "$out/catalog-summary.json" <<EOF
{"total":1,"passed":1,"failed":0,"overall_passed":true,"severity_totals":{"critical":0,"high":0,"medium":2,"low":1},"skills":[{"name":"git-master","passed":true,"reason":null,"overall_status":"passed","incomplete_scans":[],"severity_counts":{"critical":0,"high":0,"medium":2,"low":1}}]}
EOF
  exit 0
fi
if [ "$cmd" = "quality-check" ]; then
  if [ "$mode" = "crash-quality" ] || [ "$mode" = "incomplete-crash" ]; then
    echo "boom: internal quality error" >&2
    exit 2
  fi
  cat > "$out/skillevaluator-quality.json" <<EOF
{"quality_summary":[{"overall_score":91.5,"grade":"A","skill_name":"git-master","dimensions":{"correctness":{"score":100,"issues":[]},"discoverability":{"score":90,"issues":[]},"reliability":{"score":85,"issues":[]},"efficiency":{"score":85,"issues":[]}},"metrics":{"estimated_tokens":100}}]}
EOF
  exit 0
fi
exit 0
`

interface CliRun {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<CliRun> {
  const root = new URL("../..", import.meta.url).pathname
  const child = Bun.spawn(["bun", "script/skill-eval.ts", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const exitCode = await child.exited
  return { exitCode, stdout: await stdout, stderr: await stderr }
}

async function withStub<T>(mode: string, run: (stubDir: string, outDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skill-eval-test-"))
  const stubDir = join(dir, "bin")
  await mkdir(stubDir, { recursive: true })
  await writeFile(join(stubDir, "skillevaluator"), STUB_EVALUATOR, "utf8")
  await chmod(join(stubDir, "skillevaluator"), 0o755)
  try {
    return await run(stubDir, join(dir, "out"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function stubEnv(stubDir: string, mode: string): Record<string, string | undefined> {
  return { PATH: `${stubDir}:${process.env.PATH ?? ""}`, STUB_MODE: mode }
}

describe("CLI json purity", () => {
  test("keeps stdout machine-readable while progress goes to stderr", async () => {
    //#given a passing stub evaluator and --json
    //#when running the CLI
    //#then stdout parses as JSON and progress lines are on stderr only
    await withStub("pass", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--json", "--out", outDir], stubEnv(stubDir, "pass"))
      expect(run.exitCode).toBe(0)
      const parsed = JSON.parse(run.stdout) as { exported: number; inconclusive: boolean }
      expect(parsed.exported).toBe(1)
      expect(parsed.inconclusive).toBe(false)
      expect(run.stderr).toContain("exported 1 skills")
      expect(run.stdout).not.toContain("exported 1 skills")
      expect(run.stdout).not.toContain("running:")
    })
  })
})

describe("CLI quality-check failures", () => {
  test("fails the run and prints the reason when quality-check crashes", async () => {
    //#given a stub whose quality-check crashes after writing nothing
    //#when running the CLI
    //#then the run fails and the child stderr is surfaced
    await withStub("crash-quality", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "crash-quality"))
      expect(run.exitCode).toBe(1)
      expect(run.stdout).toContain("Unscored skills:")
      expect(run.stdout).toContain("boom: internal quality error")
      expect(run.stdout).toContain("No skill was scored")
    })
  })

  test("--allow-fail forces exit 0 when quality-check crashes", async () => {
    //#given the same crashing stub plus --allow-fail
    //#when running the CLI
    //#then the exit code is forced to zero
    await withStub("crash-quality", async (stubDir, outDir) => {
      const run = await runCli(
        ["eval", "--only", "git-master", "--out", outDir, "--allow-fail"],
        stubEnv(stubDir, "crash-quality"),
      )
      expect(run.exitCode).toBe(0)
    })
  })
})

describe("CLI incomplete scans", () => {
  test("reports inconclusive scans with exit code 3", async () => {
    //#given a catalog summary whose only skill has an incomplete scanner
    //#when running the CLI
    //#then the run is explicitly inconclusive rather than a gate failure
    await withStub("incomplete", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "incomplete"))
      expect(run.exitCode).toBe(3)
      expect(run.stdout).toContain("INCOMPLETE (exit 3): 1/1 skills could not be fully scanned")
      expect(run.stdout).toContain("incomplete_scans: skillspector")
      expect(run.stdout).toContain("(critical=0 high=0)")
      expect(run.stdout).toContain("inconclusive, not a content failure")
      expect(run.stdout).toContain("git-master")
    })
  })

  test("--json includes incompleteScans and overallStatus per skill", async () => {
    //#given an inconclusive stub and --json
    //#when running the CLI
    //#then the parsed summary carries the scanner gap
    await withStub("incomplete", async (stubDir, outDir) => {
      const run = await runCli(
        ["eval", "--only", "git-master", "--json", "--out", outDir],
        stubEnv(stubDir, "incomplete"),
      )
      expect(run.exitCode).toBe(3)
      const parsed = JSON.parse(run.stdout) as {
        inconclusive: boolean
        catalog: { skills: Array<{ incompleteScans: string[]; overallStatus: string | null }> }
      }
      expect(parsed.inconclusive).toBe(true)
      expect(parsed.catalog.skills[0]?.incompleteScans).toEqual(["skillspector"])
      expect(parsed.catalog.skills[0]?.overallStatus).toBe("incomplete")
    })
  })
})

describe("CLI real gate failures", () => {
  test("exits 1 when a failing skill has no incomplete scans", async () => {
    //#given a failing skill with real high findings and no scanner gap
    //#when running the CLI
    //#then the run is a gate failure, not inconclusive
    await withStub("real-failure", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "real-failure"))
      expect(run.exitCode).toBe(1)
      expect(run.stdout).not.toContain("INCOMPLETE (exit 3)")
    })
  })
})

describe("CLI exit precedence", () => {
  test("quality failures win over incomplete scans (exit 1)", async () => {
    //#given a run that is inconclusive AND every quality-check crashes
    //#when running the CLI
    //#then the real failure wins and the unscored block is printed
    await withStub("incomplete-crash", async (stubDir, outDir) => {
      const run = await runCli(
        ["eval", "--only", "git-master", "--out", outDir],
        stubEnv(stubDir, "incomplete-crash"),
      )
      expect(run.exitCode).toBe(1)
      expect(run.stdout).toContain("Unscored skills:")
      expect(run.stdout).toContain("boom: internal quality error")
      expect(run.stdout).not.toContain("INCOMPLETE (exit 3)")
    })
  })
})

describe("CLI catalog summary diagnostics", () => {
  test("reports a malformed catalog summary on stderr and exits 1", async () => {
    //#given a catalog summary that is not valid JSON
    //#when running the CLI
    //#then stderr names the file and the exit stays a real failure
    await withStub("malformed", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "malformed"))
      expect(run.exitCode).toBe(1)
      expect(run.stderr).toContain("catalog summary is unreadable")
      expect(run.stderr).toContain("catalog-summary.json")
    })
  })

  test("does not report a diagnostic when the catalog summary is missing", async () => {
    //#given a stub that writes no catalog summary at all
    //#when running the CLI
    //#then no unreadable diagnostic is emitted
    await withStub("silent", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "silent"))
      expect(run.stderr).not.toContain("catalog summary is unreadable")
    })
  })
})

describe("CLI report labels", () => {
  test("prints a single catalog-summary not-found line", async () => {
    //#given a stub that writes no catalog summary while quality still succeeds
    //#when running the CLI
    //#then the missing-summary label appears exactly once
    await withStub("silent", async (stubDir, outDir) => {
      const run = await runCli(["eval", "--only", "git-master", "--out", outDir], stubEnv(stubDir, "silent"))
      const matches = run.stdout.match(/catalog summary:/gi) ?? []
      expect(matches.length).toBe(1)
      expect(run.stdout).toContain("Per-skill markdown reports:")
    })
  })
})
