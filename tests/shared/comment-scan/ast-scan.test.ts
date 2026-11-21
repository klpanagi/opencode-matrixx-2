/// <reference types="bun-types" />
//#given the fixture cases, their frozen baselines, and the temp-file security contract from plan §4.6
//#when scanAstSources scans AST-tier sources
//#then findings match the baseline comments, the temp dir is private and removed, and caps/dedupe hold
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"

import {
  getSignalHandlerInstallCount,
  scanAstSources,
} from "../../../src/shared/comment-scan/ast-scan"
import {
  DEFAULT_MAX_FINDINGS,
  DEFAULT_SG_TIMEOUT_MS,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
} from "../../../src/shared/comment-scan/constants"
import type { CommentFinding, ScanResult, ScanSource } from "../../../src/shared/comment-scan/types"

type SpawnFn = typeof import("bun").spawn

const OPTIONS = { timeoutMs: DEFAULT_SG_TIMEOUT_MS, maxFindings: DEFAULT_MAX_FINDINGS }
const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "fixtures", "comment-scan")
const PACKAGE_MARKER = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "node_modules",
  "@ast-grep",
  "cli",
  "package.json",
)
const SKIP_REAL_SG = !existsSync(PACKAGE_MARKER) && !process.env.CI
if (SKIP_REAL_SG) {
  console.warn(
    "[comment-scan] skipping real-sg parity suite: @ast-grep/cli is not installed (run bun install to enable)",
  )
}

const AST_PARITY_CASES = ["bash", "css", "go", "html", "java", "kotlin", "python", "yaml"] as const

interface FixtureCase {
  readonly case: string
  readonly filePath: string
  readonly content: string
}

function source(filePath: string, text: string): ScanSource {
  return { filePath, text }
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>
}

interface FakeProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  readonly kill: () => void
}

function completedProcess(stdout: string, stderr: string, exitCode: number): FakeProcess {
  return {
    stdout: streamOf(stdout),
    stderr: streamOf(stderr),
    exited: Promise.resolve(exitCode),
    kill: () => undefined,
  }
}

function hangingProcess(): FakeProcess {
  return {
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    exited: new Promise<number>(() => undefined),
    kill: () => undefined,
  }
}

function spawnWith(handler: (argv: string[]) => FakeProcess): SpawnFn {
  const fn = (argv: string[]) => handler(argv)
  return fn as unknown as SpawnFn
}

function scanFiles(argv: readonly string[]): readonly string[] {
  const marker = argv.indexOf("--json=stream")
  return marker < 0 ? [] : argv.slice(marker + 1)
}

function fakeScan(respond: (files: readonly string[]) => FakeProcess): SpawnFn {
  return spawnWith((argv) =>
    argv[1] === "--version"
      ? completedProcess("ast-grep 0.40.5\n", "", 0)
      : respond(scanFiles(argv)),
  )
}

interface MatchSpec {
  readonly file: string
  readonly text: string
  readonly line: number
  readonly column?: number
  readonly lines?: string
  readonly ruleId: string
  readonly language?: string
}

function matchLine(spec: MatchSpec): string {
  const column = spec.column ?? 0
  return JSON.stringify({
    text: spec.text,
    range: {
      byteOffset: { start: 0, end: spec.text.length },
      start: { line: spec.line, column },
      end: { line: spec.line, column: column + spec.text.length },
    },
    file: spec.file,
    lines: spec.lines ?? spec.text,
    charCount: { leading: column, trailing: 0 },
    language: spec.language ?? "TypeScript",
    ruleId: spec.ruleId,
  })
}

function matchEveryFile(
  files: readonly string[],
  ruleId: (file: string) => string,
): string {
  return files
    .map((file) =>
      matchLine({
        file,
        text: "// shared",
        line: 0,
        ruleId: ruleId(file),
        language: ruleId(file) === "comment:python" ? "Python" : "TypeScript",
      }),
    )
    .join("\n")
}

function loadCase(name: string): FixtureCase {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, "cases", name, "case.json"), "utf8"),
  ) as FixtureCase
}

function baselineComments(name: string): readonly { line: number; text: string }[] {
  const xml = readFileSync(join(FIXTURE_ROOT, "baseline", `${name}.expected.txt`), "utf8")
  return [...xml.matchAll(/<comment line-number="(\d+)">([\s\S]*?)<\/comment>/g)].map(
    (match) => ({ line: Number(match[1]), text: match[2] ?? "" }),
  )
}

async function scanCase(
  name: string,
): Promise<{ fixture: FixtureCase; findings: readonly CommentFinding[] }> {
  const fixture = loadCase(name)
  const result = await scanAstSources(
    [{ filePath: fixture.filePath, text: fixture.content }],
    OPTIONS,
  )
  return { fixture, findings: result.findings }
}

describe("scanAstSources temp-file contract", () => {
  test("uses a 0o700 dir with 0o600 files and language-derived extensions", async () => {
    let dirMode = 0
    let fileModes: readonly number[] = []
    let names: readonly string[] = []
    const tempFiles: string[] = []
    const spawn = fakeScan((files) => {
      tempFiles.push(...files)
      names = files.map((file) => basename(file))
      fileModes = files.map((file) => statSync(file).mode & 0o777)
      const first = files[0]
      dirMode = first ? statSync(dirname(first)).mode & 0o777 : 0
      return completedProcess(
        matchEveryFile(files, (file) => (file.endsWith(".py") ? "comment:python" : "comment:typescript")),
        "",
        0,
      )
    })

    const result = await scanAstSources(
      [source("a.ts", "// a\n"), source("b.py", "x = 1\n")],
      OPTIONS,
      spawn,
    )

    expect(dirMode).toBe(0o700)
    expect(fileModes).toEqual([0o600, 0o600])
    expect(names.some((name) => name.endsWith(".ts"))).toBe(true)
    expect(names.some((name) => name.endsWith(".py"))).toBe(true)
    expect(tempFiles).toHaveLength(2)
    expect(result.findings).toHaveLength(2)
    const first = tempFiles[0]
    expect(first).toBeDefined()
    expect(existsSync(dirname(first ?? ""))).toBe(false)
  })

  test("keeps traversal-ish paths inside the temp dir and reports the original label", async () => {
    const tempFiles: string[] = []
    const spawn = fakeScan((files) => {
      tempFiles.push(...files)
      return completedProcess(
        files.map((file) => matchLine({ file, text: "// passwd", line: 0, ruleId: "comment:typescript" })).join("\n"),
        "",
        0,
      )
    })

    const result = await scanAstSources([source("../../etc/passwd.ts", "// passwd\n")], OPTIONS, spawn)

    const tempFile = tempFiles[0] ?? ""
    expect(tempFile).not.toBe("")
    expect(resolve(dirname(tempFile)).startsWith(resolve(tmpdir()) + sep)).toBe(true)
    expect(basename(dirname(tempFile)).startsWith("matrixx-comment-scan-")).toBe(true)
    expect(basename(tempFile)).toBe("src-0-passwd.ts")
    expect(basename(tempFile)).not.toContain("..")
    expect(result.findings[0]?.file).toBe("../../etc/passwd.ts")
    expect(existsSync(tempFile)).toBe(false)
  })

  test("reports an error when sg reports a match for an escaping path", async () => {
    const spawn = fakeScan(() =>
      completedProcess(
        matchLine({
          file: "../../etc/passwd.ts",
          text: "// passwd",
          line: 0,
          ruleId: "comment:typescript",
        }),
        "",
        0,
      ),
    )

    const result = await scanAstSources(
      [source("../../etc/passwd.ts", "// passwd\n")],
      OPTIONS,
      spawn,
    )

    expect(result.findings).toEqual([])
    expect((result.errors ?? []).join("\n")).toContain("unknown file")
  })
})

describe("scanAstSources result shape", () => {
  test("returns a ScanResult at the type level", async () => {
    const spawn = fakeScan(() => completedProcess("", "", 0))

    const result: ScanResult = await scanAstSources([source("a.ts", "// a\n")], OPTIONS, spawn)

    expect(result.findings).toEqual([])
    expect(result.skipped).toBeUndefined()
  })
})

describe("scanAstSources source selection", () => {
  test("records an oversize source in errors but still scans the rest", async () => {
    const scanned: string[] = []
    const spawn = fakeScan((files) => {
      scanned.push(...files)
      return completedProcess(
        files.map((file) => matchLine({ file, text: "// ok", line: 0, ruleId: "comment:typescript" })).join("\n"),
        "",
        0,
      )
    })

    const result = await scanAstSources(
      [source("huge.ts", "a".repeat(MAX_FILE_BYTES + 1)), source("small.ts", "// ok\n")],
      OPTIONS,
      spawn,
    )

    expect(scanned).toHaveLength(1)
    expect(result.findings).toHaveLength(1)
    expect(result.skipped).toBeUndefined()
    expect((result.errors ?? []).join("\n")).toContain("huge.ts")
  })

  test("scans a duplicate body once and maps findings back to every source", async () => {
    const scanned: string[] = []
    const spawn = fakeScan((files) => {
      scanned.push(...files)
      return completedProcess(
        files.map((file) => matchLine({ file, text: "// shared", line: 0, ruleId: "comment:typescript" })).join("\n"),
        "",
        0,
      )
    })

    const result = await scanAstSources(
      [source("a.ts", "// shared\n"), source("b.ts", "// shared\n")],
      OPTIONS,
      spawn,
    )

    expect(scanned).toHaveLength(1)
    expect(result.findings.map((finding) => finding.file)).toEqual(["a.ts", "b.ts"])
    expect(result.findings.map((finding) => finding.line)).toEqual([1, 1])
  })

  test("skips non-AST languages silently without spawning sg", async () => {
    let spawned = false
    const spawn = spawnWith((argv) => {
      spawned = true
      return argv[1] === "--version"
        ? completedProcess("ast-grep 0.40.5\n", "", 0)
        : completedProcess("", "", 0)
    })

    const result = await scanAstSources(
      [source("query.sql", "-- c\n"), source("config.jsonc", "// c\n")],
      OPTIONS,
      spawn,
    )

    expect(spawned).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.errors).toBeUndefined()
    expect(result.skipped).toBeUndefined()
  })

  test("reports unsupported only when every source resolved to no language", async () => {
    let spawned = false
    const spawn = spawnWith(() => {
      spawned = true
      return completedProcess("", "", 0)
    })

    const result = await scanAstSources([source("README", "hello\n")], OPTIONS, spawn)

    expect(spawned).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.skipped).toBe("unsupported")
  })

  test("chunks file lists at MAX_BATCH_FILES into separate sg invocations", async () => {
    const batchSizes: number[] = []
    const spawn = fakeScan((files) => {
      batchSizes.push(files.length)
      return completedProcess("", "", 0)
    })
    const sources = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) =>
      source(`f${index}.ts`, `// comment ${index}\n`),
    )

    const result = await scanAstSources(sources, OPTIONS, spawn)

    expect(batchSizes).toEqual([MAX_BATCH_FILES, 1])
    expect(result.findings).toEqual([])
    expect(result.skipped).toBeUndefined()
  })
})

describe("scanAstSources finding mapping", () => {
  test("maps matches to 1-based lines with trailing and docstring metadata", async () => {
    const spawn = fakeScan((files) => {
      const file = files[0] ?? ""
      return completedProcess(
        [
          matchLine({ file, text: '"""docs"""', line: 0, ruleId: "docstring:python:module", language: "Python" }),
          matchLine({
            file,
            text: "# indented",
            line: 1,
            column: 4,
            lines: "    # indented",
            ruleId: "comment:python",
            language: "Python",
          }),
          matchLine({
            file,
            text: "# tail",
            line: 2,
            column: 11,
            lines: "value = 1 # tail",
            ruleId: "comment:python",
            language: "Python",
          }),
        ].join("\n"),
        "",
        0,
      )
    })

    const result = await scanAstSources([source("module.py", '"""docs"""\n')], OPTIONS, spawn)

    expect(result.findings[0]).toMatchObject({
      file: "module.py",
      line: 1,
      tier: "ast",
      isDocstring: true,
      trailing: false,
      language: "python",
      text: '"""docs"""',
    })
    expect(result.findings[1]).toMatchObject({ line: 2, isDocstring: false, trailing: false })
    expect(result.findings[2]).toMatchObject({ line: 3, isDocstring: false, trailing: true })
  })

  test("trims the trailing newline from a Rust doc comment", async () => {
    const spawn = fakeScan((files) => {
      const file = files[0] ?? ""
      return completedProcess(
        matchLine({ file, text: "/// Docs\n", line: 0, ruleId: "comment:rust", language: "Rust" }),
        "",
        0,
      )
    })

    const result = await scanAstSources(
      [source("lib.rs", "/// Docs\npub fn x() {}\n")],
      OPTIONS,
      spawn,
    )

    expect(result.findings[0]?.text).toBe("/// Docs")
  })

  test("surfaces a rule-parse failure as an error without claiming unsupported", async () => {
    const stderr = "Error: Cannot parse rule INLINE_RULES\n╰▻ Fail to parse yaml as Rule."
    const spawn = fakeScan(() => completedProcess("", stderr, 1))

    const result = await scanAstSources([source("a.ts", "// a\n")], OPTIONS, spawn)

    expect(result.findings).toEqual([])
    expect(result.skipped).toBeUndefined()
    expect((result.errors ?? []).join("\n")).toContain("Cannot parse rule")
  })

  test("maps a timed-out scan to skipped timeout", async () => {
    const spawn = spawnWith((argv) =>
      argv[1] === "--version" ? completedProcess("ast-grep 0.40.5\n", "", 0) : hangingProcess(),
    )

    const result = await scanAstSources(
      [source("a.ts", "// a\n")],
      { timeoutMs: 10, maxFindings: 10 },
      spawn,
    )

    expect(result.findings).toEqual([])
    expect(result.skipped).toBe("timeout")
  })

  test("keeps a finding for a 900 KB comment instead of dropping its stream line", async () => {
    const comment = `// ${"a".repeat(900 * 1024)}`
    const spawn = fakeScan((files) => {
      const file = files[0] ?? ""
      return completedProcess(
        matchLine({ file, text: comment, line: 0, ruleId: "comment:typescript" }),
        "",
        0,
      )
    })

    const result = await scanAstSources(
      [source("huge.ts", `${comment}\n`)],
      OPTIONS,
      spawn,
    )

    expect(result.findings).toHaveLength(1)
    expect((result.errors ?? []).join("\n")).not.toContain("Malformed")
  })

  test("records an error when sg truncates its match output", async () => {
    const spawn = fakeScan((files) => {
      const file = files[0] ?? ""
      const lines = Array.from({ length: 501 }, (_, index) =>
        matchLine({ file, text: `// note ${index}`, line: index, ruleId: "comment:typescript" }),
      )
      return completedProcess(lines.join("\n"), "", 0)
    })

    const result = await scanAstSources([source("a.ts", "// a\n")], OPTIONS, spawn)

    expect((result.errors ?? []).join("\n")).toContain(
      "sg output truncated for a.ts; findings are incomplete",
    )
  })
})

describe("scanAstSources adaptive bisection", () => {
  function truncatedStream(files: readonly string[]): string {
    const file = files[0] ?? ""
    return Array.from({ length: 501 }, (_, index) =>
      matchLine({ file, text: `// t${index}`, line: index, ruleId: "comment:typescript" }),
    ).join("\n")
  }

  test("bisects a truncated multi-file chunk until every file is covered", async () => {
    const invocationSizes: number[] = []
    const spawn = fakeScan((files) => {
      invocationSizes.push(files.length)
      if (files.length >= 4) {
        return completedProcess(truncatedStream(files), "", 0)
      }
      return completedProcess(
        files
          .map((file) =>
            matchLine({ file, text: "// done", line: 0, ruleId: "comment:typescript" }),
          )
          .join("\n"),
        "",
        0,
      )
    })
    const sources = Array.from({ length: 4 }, (_, index) =>
      source(`f${index}.ts`, `// c${index}\n`),
    )

    const result = await scanAstSources(sources, OPTIONS, spawn)

    expect(invocationSizes).toEqual([4, 2, 2])
    expect(result.findings.map((finding) => finding.file).sort()).toEqual([
      "f0.ts",
      "f1.ts",
      "f2.ts",
      "f3.ts",
    ])
    expect(result.errors).toBeUndefined()
  })

  test("keeps a single-file truncated result and names only that file", async () => {
    const spawn = fakeScan((files) => completedProcess(truncatedStream(files), "", 0))

    const result = await scanAstSources(
      [source("generated.ts", "// c\n")],
      OPTIONS,
      spawn,
    )

    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.errors).toEqual([
      "sg output truncated for generated.ts; findings are incomplete",
    ])
  })

  test("does not bisect a rule-parse failure", async () => {
    const invocationSizes: number[] = []
    const stderr = "Error: Cannot parse rule INLINE_RULES\n╰▻ Fail to parse yaml as Rule."
    const spawn = fakeScan((files) => {
      invocationSizes.push(files.length)
      return completedProcess("", stderr, 1)
    })
    const sources = Array.from({ length: 5 }, (_, index) =>
      source(`f${index}.ts`, `// c${index}\n`),
    )

    const result = await scanAstSources(sources, OPTIONS, spawn)

    expect(invocationSizes).toEqual([5])
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]).toContain("Cannot parse rule")
  })

  test("per-file retries consume the ast-scan invocation budget", async () => {
    const invocationSizes: number[] = []
    const spawn = fakeScan((files) => {
      invocationSizes.push(files.length)
      if (files.length > 1) return completedProcess('{"partial":', "", 0)
      return completedProcess(
        matchLine({ file: files[0] ?? "", text: "// ok", line: 0, ruleId: "comment:typescript" }),
        "",
        0,
      )
    })
    const sources = Array.from({ length: 5 }, (_, index) =>
      source(`f${index}.ts`, `// c${index}\n`),
    )

    const result = await scanAstSources(sources, { ...OPTIONS, maxInvocations: 2 }, spawn)

    expect(invocationSizes).toHaveLength(2)
    expect((result.errors ?? []).join("\n")).toContain(
      "retry budget exhausted; findings may be incomplete",
    )
  })

  test("stops when the invocation budget is exhausted", async () => {
    const invocationSizes: number[] = []
    const spawn = fakeScan((files) => {
      invocationSizes.push(files.length)
      return completedProcess(truncatedStream(files), "", 0)
    })
    const sources = Array.from({ length: 4 }, (_, index) =>
      source(`f${index}.ts`, `// c${index}\n`),
    )

    const result = await scanAstSources(sources, { ...OPTIONS, maxInvocations: 1 }, spawn)

    expect(invocationSizes).toEqual([4])
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]).toContain("1 sg invocations")
    expect(result.errors?.[0]).toContain("NOT scanned")
  })
})

describe("scanAstSources signal cleanup", () => {
  test("registers the signal handler once across sequential scans", async () => {
    const spawn = fakeScan(() => completedProcess("", "", 0))
    const installsBefore = getSignalHandlerInstallCount()
    const listenersBefore = process.listenerCount("SIGINT")

    await scanAstSources([source("a.ts", "// a\n")], OPTIONS, spawn)
    const installsAfterFirst = getSignalHandlerInstallCount()
    const listenersAfterFirst = process.listenerCount("SIGINT")
    await scanAstSources([source("b.ts", "// b\n")], OPTIONS, spawn)
    await scanAstSources([source("c.ts", "// c\n")], OPTIONS, spawn)

    expect(installsAfterFirst - installsBefore).toBeLessThanOrEqual(1)
    expect(getSignalHandlerInstallCount()).toBe(installsAfterFirst)
    expect(listenersAfterFirst - listenersBefore).toBeLessThanOrEqual(1)
    expect(process.listenerCount("SIGINT")).toBe(listenersAfterFirst)
  })
})

describe.skipIf(SKIP_REAL_SG)("scanAstSources against the real sg binary", () => {
  for (const name of AST_PARITY_CASES) {
    test(`reproduces the comments in baseline/${name}.expected.txt`, async () => {
      const { fixture, findings } = await scanCase(name)
      const expected = baselineComments(name)

      expect(expected.length).toBeGreaterThan(0)
      for (const entry of expected) {
        const matched = findings.some(
          (finding) =>
            finding.file === fixture.filePath &&
            finding.line === entry.line &&
            finding.text === entry.text,
        )
        expect({ name, line: entry.line, matched }).toEqual({ name, line: entry.line, matched: true })
      }

      const extras = findings.filter(
        (finding) => !expected.some((entry) => entry.line === finding.line && entry.text === finding.text),
      )
      for (const extra of extras) {
        expect({ name, text: extra.text, shebang: extra.text.startsWith("#!") }).toEqual({
          name,
          text: extra.text,
          shebang: true,
        })
      }

      expect(findings.every((finding) => finding.tier === "ast")).toBe(true)
      expect(findings.map((finding) => finding.line)).toEqual(
        [...findings.map((finding) => finding.line)].sort((left, right) => left - right),
      )
    })
  }

  test("produces non-empty findings for kind:comment, Java, and Kotlin files", async () => {
    const go = await scanCase("go")
    const java = await scanCase("java")
    const kotlin = await scanCase("kotlin")

    expect(go.findings.length).toBeGreaterThan(0)
    expect(java.findings.length).toBeGreaterThan(0)
    expect(kotlin.findings.length).toBeGreaterThan(0)
  })

  test("reports exactly one finding for a rust /// line", async () => {
    const { findings } = await scanCase("rust")
    const docLine = findings.filter((finding) => finding.line === 8)

    expect(docLine).toHaveLength(1)
    expect(docLine[0]?.text).toBe("/// Documented accessor for the page size.")
  })

  test("marks python module and class docstrings as docstrings only", async () => {
    const { findings } = await scanCase("python")
    const docstrings = findings.filter((finding) => finding.isDocstring)

    expect(docstrings.map((finding) => finding.line)).toEqual([1, 16])
    expect(docstrings.every((finding) => finding.language === "python")).toBe(true)
  })

  test("pins trailing to code before the comment on the same line", async () => {
    const java = await scanCase("java")
    const html = await scanCase("html")

    expect(java.findings.filter((finding) => finding.trailing).map((finding) => finding.line)).toEqual([12])
    expect(html.findings.every((finding) => finding.trailing)).toBe(false)
  })
})
