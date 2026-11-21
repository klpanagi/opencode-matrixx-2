/// <reference types="bun-types" />
//#given the resolved comment-scan primitives
//#when scanSources partitions sources, runs both tiers through the bounded queue, and filters
//#then tiers merge deterministically and queue failures stay inside the ScanResult
import { describe, expect, test } from "bun:test"

import * as barrel from "../../../src/shared/comment-scan"
import type {
  AstLanguage,
  CommentFinding,
  RegexLanguage,
  ScanLanguage,
  ScanOptions,
  ScanResult,
  ScanSource,
  ScanSourcesOptions,
  ScanTier,
} from "../../../src/shared/comment-scan"
import { DEFAULT_MAX_FINDINGS } from "../../../src/shared/comment-scan/constants"
import { QueueTimeoutError } from "../../../src/shared/comment-scan/queue"
import { scanSources } from "../../../src/shared/comment-scan/scan"
import { SgUnavailableError } from "../../../src/shared/comment-scan/sg-invoke"
import type { BoundedQueue } from "../../../src/shared/comment-scan/types"

type BarrelTypes = [
  ScanSource,
  ScanOptions,
  ScanResult,
  CommentFinding,
  ScanTier,
  ScanLanguage,
  AstLanguage,
  RegexLanguage,
  ScanSourcesOptions,
]

interface FindingOptions {
  readonly file: string
  readonly line: number
  readonly text?: string
  readonly tier?: ScanTier
  readonly language?: ScanLanguage
}

function finding(options: FindingOptions): CommentFinding {
  return {
    file: options.file,
    line: options.line,
    text: options.text ?? `// note ${options.line}`,
    tier: options.tier ?? "ast",
    isDocstring: false,
    trailing: false,
    language: options.language ?? "typescript",
  }
}

function source(filePath: string): ScanSource {
  return { filePath, text: "" }
}

function passthroughQueue(): BoundedQueue {
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return task()
    },
    active: 0,
    pending: 0,
  }
}

function failFirstQueue(error: Error): BoundedQueue {
  let calls = 0
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      calls += 1
      return calls === 1 ? Promise.reject(error) : task()
    },
    active: 0,
    pending: 0,
  }
}

function location(findingResult: CommentFinding): string {
  return `${findingResult.file}:${findingResult.line}`
}

describe("scanSources", () => {
  test("merges AST and regex findings in one call, sorted by source order then line", async () => {
    //#given one AST source and one regex source, each with a finding
    const sources = [source("/repo/b.sql"), source("/repo/a.ts")]

    //#when both tiers run
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 4, text: "// ast note" })],
      }),
      scanRegex: () => [
        finding({
          file: "/repo/b.sql",
          line: 2,
          text: "-- regex note",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then both findings survive in the order the caller supplied the sources
    expect(result.findings.map(location)).toEqual(["/repo/b.sql:2", "/repo/a.ts:4"])
    expect(result.skipped).toBeUndefined()
  })

  test("tier ast runs only the AST partition", async () => {
    //#given sources for both tiers
    const sources = [source("/repo/a.ts"), source("/repo/b.sql")]

    //#when tier selects AST only
    const result = await scanSources(sources, {
      tier: "ast",
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 1, text: "// ast note" })],
      }),
      scanRegex: () => {
        throw new Error("regex partition must not run")
      },
    })

    //#then only the AST finding is returned
    expect(result.findings.map(location)).toEqual(["/repo/a.ts:1"])
  })

  test("tier regex runs only the regex partition", async () => {
    //#given sources for both tiers
    const sources = [source("/repo/a.ts"), source("/repo/b.sql")]

    //#when tier selects regex only
    const result = await scanSources(sources, {
      tier: "regex",
      queue: passthroughQueue(),
      scanAst: async () => {
        throw new Error("AST partition must not run")
      },
      scanRegex: () => [
        finding({
          file: "/repo/b.sql",
          line: 3,
          text: "-- regex note",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then only the regex finding is returned
    expect(result.findings.map(location)).toEqual(["/repo/b.sql:3"])
  })

  test("reports an error when tier ast excludes every resolved source", async () => {
    //#given a regex-only source and AST tier
    const result = await scanSources([source("/repo/b.sql")], {
      tier: "ast",
      queue: passthroughQueue(),
    })

    //#then the empty result names the exclusion instead of looking successful
    expect(result.findings).toEqual([])
    expect(result.skipped).toBeUndefined()
    expect(result.errors).toEqual(['tier "ast" excludes the 1 resolved source(s)'])
  })

  test("reports an error when tier regex excludes every resolved source", async () => {
    //#given an AST-only source and regex tier
    const result = await scanSources([source("/repo/a.ts")], {
      tier: "regex",
      queue: passthroughQueue(),
    })

    //#then the empty result names the exclusion instead of looking successful
    expect(result.findings).toEqual([])
    expect(result.skipped).toBeUndefined()
    expect(result.errors).toEqual(['tier "regex" excludes the 1 resolved source(s)'])
  })

  test("preserves caller source order instead of sorting by filename", async () => {
    //#given sources supplied in non-alphabetical order
    const sources = [source("/repo/z.ts"), source("/repo/a.ts"), source("/repo/m.ts")]

    //#when the AST partition reports them out of order
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [
          finding({ file: "/repo/m.ts", line: 2, text: "// m" }),
          finding({ file: "/repo/z.ts", line: 1, text: "// z" }),
          finding({ file: "/repo/a.ts", line: 9, text: "// a" }),
        ],
      }),
    })

    //#then findings follow the caller's source order
    expect(result.findings.map((item) => item.file)).toEqual([
      "/repo/z.ts",
      "/repo/a.ts",
      "/repo/m.ts",
    ])
  })

  test("ignores sources whose language cannot be resolved", async () => {
    //#given sources with no scan language
    const sources = [source("/repo/notes.txt"), source("/repo/Makefile")]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => {
        throw new Error("AST partition must not run")
      },
      scanRegex: () => {
        throw new Error("regex partition must not run")
      },
    })

    //#then the result is a silent unsupported batch
    expect(result).toEqual({ findings: [], skipped: "unsupported" })
  })

  test("dedupes the same file and line across tiers, preferring the AST finding", async () => {
    //#given both tiers reporting the same location with different text
    const sources = [source("/repo/a.ts"), source("/repo/a.sql")]

    //#when scanSources merges them
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 3, text: "// duplicate" })],
      }),
      scanRegex: () => [
        finding({
          file: "/repo/a.ts",
          line: 3,
          text: "/* duplicate */",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then the location appears once and the AST copy wins
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.tier).toBe("ast")
  })

  test("keeps genuinely different comments that share a line across tiers", async () => {
    //#given AST and regex findings on the same line with different bodies
    const result = await scanSources([source("/repo/a.ts"), source("/repo/a.sql")], {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 3, text: "// keep me" })],
      }),
      scanRegex: () => [
        finding({
          file: "/repo/a.ts",
          line: 3,
          text: "/* different */",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then both survive because the body is part of the dedupe key
    expect(result.findings).toHaveLength(2)
    expect(result.findings.map((item) => item.text)).toEqual(["// keep me", "/* different */"])
  })

  test("caps findings at the default limit", async () => {
    //#given more findings than the default cap
    const many = Array.from({ length: DEFAULT_MAX_FINDINGS + 5 }, (_, index) =>
      finding({ file: "/repo/a.ts", line: index + 1, text: `// note ${index + 1}` }),
    )

    //#when scanSources finishes
    const result = await scanSources([source("/repo/a.ts")], {
      queue: passthroughQueue(),
      scanAst: async () => ({ findings: many }),
    })

    //#then only the first capped, sorted findings survive and the cap is reported
    expect(result.findings).toHaveLength(DEFAULT_MAX_FINDINGS)
    expect(result.findings.at(-1)?.line).toBe(DEFAULT_MAX_FINDINGS)
    expect(result.errors).toEqual([
      `Finding cap reached: showing ${DEFAULT_MAX_FINDINGS} of ${many.length} findings`,
    ])
  })

  test("reports exactly how many findings the cap dropped", async () => {
    //#given 300 distinct comments
    const many = Array.from({ length: 300 }, (_, index) =>
      finding({ file: "/repo/a.ts", line: index + 1, text: `// cap ${index}` }),
    )

    //#when scanSources applies the default cap
    const result = await scanSources([source("/repo/a.ts")], {
      queue: passthroughQueue(),
      scanAst: async () => ({ findings: many }),
    })

    //#then the cap is stated with both counts
    expect(result.findings).toHaveLength(DEFAULT_MAX_FINDINGS)
    expect(result.errors).toEqual([
      `Finding cap reached: showing ${DEFAULT_MAX_FINDINGS} of 300 findings`,
    ])
  })

  test("maps a queue timeout to skipped without dropping the completed partition", async () => {
    //#given the AST partition times out inside the queue
    const sources = [source("/repo/a.ts"), source("/repo/b.sql")]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: failFirstQueue(new QueueTimeoutError(20_000, 20_000)),
      scanAst: async () => {
        throw new Error("timed-out task must not resolve")
      },
      scanRegex: () => [
        finding({
          file: "/repo/b.sql",
          line: 1,
          text: "-- regex note",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then the regex findings survive and the batch reports a timeout skip
    expect(result.skipped).toBe("timeout")
    expect(result.findings.map(location)).toEqual(["/repo/b.sql:1"])
  })

  test("records a generic task error without throwing or losing other findings", async () => {
    //#given the AST partition fails with an unexpected error
    const sources = [source("/repo/a.ts"), source("/repo/b.sql")]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: failFirstQueue(new Error("sg exploded")),
      scanAst: async () => ({ findings: [] }),
      scanRegex: () => [
        finding({
          file: "/repo/b.sql",
          line: 1,
          text: "-- regex note",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then the message is recorded and the regex findings are intact
    expect(result.errors).toEqual([
      "sg exploded",
      "AST tier produced no findings and reported errors; results may be incomplete",
    ])
    expect(result.findings.map(location)).toEqual(["/repo/b.sql:1"])
    expect(result.skipped).toBeUndefined()
  })

  test("maps a missing sg binary with no AST findings to binary-missing", async () => {
    //#given the AST partition rejects with SgUnavailableError
    const result = await scanSources([source("/repo/a.ts")], {
      queue: passthroughQueue(),
      scanAst: async () => {
        throw new SgUnavailableError()
      },
    })

    //#then the batch is skipped as binary-missing, not an error
    expect(result.skipped).toBe("binary-missing")
    expect(result.findings).toEqual([])
  })

  test("flags an AST partition that reports errors but yields no findings", async () => {
    //#given an AST partition with a rule-parse error and a working regex partition
    const result = await scanSources([source("/repo/a.ts"), source("/repo/b.sql")], {
      queue: passthroughQueue(),
      scanAst: async () => ({ findings: [], errors: ["Cannot parse rule INLINE_RULES"] }),
      scanRegex: () => [
        finding({
          file: "/repo/b.sql",
          line: 1,
          text: "-- regex note",
          tier: "regex",
          language: "sql",
        }),
      ],
    })

    //#then regex findings survive and the silent-zero AST result is called out
    expect(result.findings.map(location)).toEqual(["/repo/b.sql:1"])
    expect(result.errors).toContain("Cannot parse rule INLINE_RULES")
    expect(result.errors).toContain(
      "AST tier produced no findings and reported errors; results may be incomplete",
    )
  })

  test("keeps AST findings and records the error when sg is unavailable mid-result", async () => {
    //#given an AST partition that returns findings alongside a binary-missing marker
    const result = await scanSources([source("/repo/a.ts")], {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 1, text: "// ast note" })],
        skipped: "binary-missing",
        errors: ["sg gone"],
      }),
    })

    //#then the findings survive, the error is recorded, and the batch is not skipped
    expect(result.findings.map(location)).toEqual(["/repo/a.ts:1"])
    expect(result.errors).toEqual(["sg gone"])
    expect(result.skipped).toBeUndefined()
  })

  test("returns an unsupported skip for empty input", async () => {
    //#given no sources
    //#when scanSources runs
    const result = await scanSources([])

    //#then the batch is unsupported with no findings
    expect(result).toEqual({ findings: [], skipped: "unsupported" })
  })
})

describe("comment-scan barrel", () => {
  test("exports exactly the public runtime surface", () => {
    //#given the package barrel
    //#when enumerating its runtime exports
    //#then only the orchestrator, render helper, and rubric are exposed
    expect(Object.keys(barrel).sort()).toEqual([
      "RUBRIC_TEMPLATE",
      "formatReport",
      "scanPaths",
      "scanSources",
    ])
    expect(typeof barrel.scanSources).toBe("function")
    expect(typeof barrel.scanPaths).toBe("function")
    expect(typeof barrel.formatReport).toBe("function")
    expect(typeof barrel.RUBRIC_TEMPLATE).toBe("string")
  })

  test("re-exports the public types", () => {
    //#given the barrel's type re-exports
    const types: BarrelTypes | null = null

    //#when compiled and run
    //#then the type-only surface resolves
    expect(types).toBeNull()
  })
})

describe("scanSources compareText", () => {
  test("drops only the pre-existing body for the edited source", async () => {
    //#given an edited source whose compareText contains one of its two bodies
    const sources: ScanSource[] = [
      {
        filePath: "/repo/a.ts",
        text: "// keep\n\n// pre-existing",
        compareText: "const x = 1\n// pre-existing\n",
      },
      source("/repo/b.ts"),
    ]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [
          finding({ file: "/repo/a.ts", line: 1, text: "// keep" }),
          finding({ file: "/repo/a.ts", line: 3, text: "// pre-existing" }),
          finding({ file: "/repo/b.ts", line: 1, text: "// other" }),
        ],
      }),
    })

    //#then only the pre-existing comment is subtracted
    expect(result.findings.map(location)).toEqual(["/repo/a.ts:1", "/repo/b.ts:1"])
    expect(result.errors).toBeUndefined()
    expect(result.skipped).toBeUndefined()
  })

  test("drops every body when compareText covers the whole file, leaving other files intact", async () => {
    //#given a source whose compareText repeats its whole content
    const sources: ScanSource[] = [
      { filePath: "/repo/a.ts", text: "// one\n// two", compareText: "// one\n// two" },
      source("/repo/b.ts"),
    ]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [
          finding({ file: "/repo/a.ts", line: 1, text: "// one" }),
          finding({ file: "/repo/a.ts", line: 2, text: "// two" }),
          finding({ file: "/repo/b.ts", line: 7, text: "// other" }),
        ],
      }),
    })

    //#then the covered file contributes nothing and the other file is untouched
    expect(result.findings.map(location)).toEqual(["/repo/b.ts:7"])
    expect(result.skipped).toBeUndefined()
  })

  test("never applies one source's compareText to another file", async () => {
    //#given a source whose compareText contains another file's body
    const sources: ScanSource[] = [
      { filePath: "/repo/a.ts", text: "// unrelated", compareText: "// shared" },
      source("/repo/b.ts"),
    ]

    //#when scanSources runs
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [
          finding({ file: "/repo/a.ts", line: 1, text: "// unrelated" }),
          finding({ file: "/repo/b.ts", line: 1, text: "// shared" }),
        ],
      }),
    })

    //#then both findings survive because compareText is scoped to its file
    expect(result.findings.map(location)).toEqual(["/repo/a.ts:1", "/repo/b.ts:1"])
  })

  test("subtracts compareText per source when two edits share one file", async () => {
    //#given two edits to the same file; the second adds a comment found in the first edit's old text
    const sources: ScanSource[] = [
      {
        filePath: "/repo/a.ts",
        text: "const a = 1\n",
        compareText: "// note\nconst a = 1\n",
      },
      {
        filePath: "/repo/a.ts",
        text: "// note\nexport const b = 2\n",
        compareText: "export const b = 2\n",
      },
    ]

    //#when the second edit's new comment is scanned
    const result = await scanSources(sources, {
      queue: passthroughQueue(),
      scanAst: async () => ({
        findings: [finding({ file: "/repo/a.ts", line: 1, text: "// note" })],
      }),
    })

    //#then the finding survives because only its own source's compareText applies
    expect(result.findings.map(location)).toEqual(["/repo/a.ts:1"])
  })
})
