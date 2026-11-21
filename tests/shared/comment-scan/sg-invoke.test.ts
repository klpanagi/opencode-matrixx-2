/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  findPackagedSgBinary,
  isRuleParseError,
  resolveSgBinary,
  runSgScan,
  SgUnavailableError,
  type SgScanRequest,
} from "../../../src/shared/comment-scan/sg-invoke"
import type { InlineRuleSet } from "../../../src/shared/comment-scan/types"

type SpawnFn = typeof import("bun").spawn

const TS_RULES: InlineRuleSet = {
  yaml: "id: comment:typescript\nlanguage: TypeScript\nrule: {kind: comment}",
  ruleMeta: { "comment:typescript": { language: "typescript", isDocstring: false } },
}

const JAVA_RULES: InlineRuleSet = {
  yaml: "id: comment:java\nlanguage: Java\nrule: {kind: comment}",
  ruleMeta: { "comment:java": { language: "java", isDocstring: false } },
}

const VERIFIED_TRAILING_LINE =
  '{"text":"// trailing","range":{"byteOffset":{"start":11,"end":22},"start":{"line":0,"column":11},"end":{"line":0,"column":22}},"file":"sample.ts","lines":"int x = 1; // trailing","charCount":{"leading":11,"trailing":0},"language":"TypeScript","ruleId":"comment:typescript","severity":"hint","note":null,"message":"","labels":[]}'

const VERIFIED_STANDALONE_LINE =
  '{"text":"// standalone","range":{"byteOffset":{"start":23,"end":36},"start":{"line":1,"column":0},"end":{"line":1,"column":13}},"file":"sample.ts","lines":"// standalone","charCount":{"leading":0,"trailing":0},"language":"TypeScript","ruleId":"comment:typescript","severity":"hint","note":null,"message":"","labels":[]}'

const JAVA_RULE_PARSE_STDERR = [
  "Error: Cannot parse rule INLINE_RULES",
  "Help: The file is not a valid ast-grep rule. Please refer to doc and fix the error.",
  "See also: https://ast-grep.github.io/guide/rule-config.html",
  "",
  "✖ Caused by",
  "╰▻ Fail to parse yaml as Rule.",
  "╰▻ `rule` is not configured correctly.",
  "╰▻ Rule contains invalid kind matcher.",
  "╰▻ Invalid Kind",
  "╰▻ Kind `comment` is invalid.",
].join("\n")

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>
}

function matchLine(index: number): string {
  return JSON.stringify({
    text: `// comment ${index}`,
    range: {
      byteOffset: { start: index, end: index + 1 },
      start: { line: index, column: 0 },
      end: { line: index, column: 1 },
    },
    file: "sample.ts",
    lines: `// comment ${index}`,
    charCount: { leading: 0, trailing: 0 },
    language: "TypeScript",
    ruleId: "comment:typescript",
  })
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

function hangingProcess(onKill: () => void): FakeProcess {
  return {
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    exited: new Promise<number>(() => undefined),
    kill: onKill,
  }
}

interface FakeCall {
  readonly argv: string[]
  readonly options: unknown
}

function fakeSpawnFor(handler: (argv: string[]) => FakeProcess, calls: FakeCall[]): SpawnFn {
  const fn = (argv: string[], options: unknown) => {
    calls.push({ argv, options })
    return handler(argv)
  }
  return fn as unknown as SpawnFn
}

function scanFake(
  stdout: string,
  stderr: string,
  exitCode: number,
  calls: FakeCall[],
): SpawnFn {
  return fakeSpawnFor(
    (argv) =>
      argv[1] === "--version"
        ? completedProcess("ast-grep 0.40.5\n", "", 0)
        : completedProcess(stdout, stderr, exitCode),
    calls,
  )
}

function scanFilesFrom(argv: readonly string[]): readonly string[] {
  return argv.slice(argv.indexOf("--json=stream") + 1)
}

function request(overrides: Partial<SgScanRequest> = {}): SgScanRequest {
  return {
    rules: TS_RULES,
    files: ["sample.ts"],
    cwd: "/tmp/comment-scan-cwd",
    ...overrides,
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

describe("runSgScan stream parsing", () => {
  test("parses verified JSON lines and tolerates blank and malformed lines", async () => {
    //#given stdout with two verified matches, blank lines and a truncated tail
    const calls: FakeCall[] = []
    const stdout = `${VERIFIED_TRAILING_LINE}\n\n${VERIFIED_STANDALONE_LINE}\n{"partial":`
    const spawnFn = scanFake(stdout, "", 0, calls)

    //#when the scan runs with an injected spawn
    const result = await runSgScan(request(), spawnFn)

    //#then both matches parse and the malformed tail is reported without throwing
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]?.text).toBe("// trailing")
    expect(result.matches[0]?.range.start.line).toBe(0)
    expect(result.matches[0]?.charCount.leading).toBe(11)
    expect(result.matches[0]?.language).toBe("TypeScript")
    expect(result.matches[1]?.text).toBe("// standalone")
    expect(result.timedOut).toBe(false)
    expect(result.truncated).toBe(false)
    expect(result.stderr).toContain("Malformed")
  })

  test("passes the inline rules, stream flag, files, and cwd to spawn without a shell", async () => {
    //#given a request with two files and a working directory
    const calls: FakeCall[] = []
    const spawnFn = scanFake("", "", 0, calls)

    //#when the scan runs
    await runSgScan(request({ files: ["a.ts", "b.ts"], cwd: "/work/dir" }), spawnFn)

    //#then the resolved binary is probed once before the scan
    expect(calls.filter((call) => call.argv[1] === "--version")).toHaveLength(1)
    const scanCall = calls.find((call) => call.argv[1] === "scan")
    expect(scanCall).toBeDefined()
    if (!scanCall) {
      throw new Error("scan was not spawned")
    }

    //#then argv carries scan, the yaml, and the files exactly
    expect(scanCall.argv.slice(1)).toEqual([
      "scan",
      "--inline-rules",
      TS_RULES.yaml,
      "--json=stream",
      "a.ts",
      "b.ts",
    ])
    expect(typeof scanCall.argv[0]).toBe("string")

    //#then cwd is forwarded and no shell is requested
    const options = scanCall.options as { cwd?: string; shell?: boolean }
    expect(options.cwd).toBe("/work/dir")
    expect(options.shell).toBeUndefined()
  })

  test("skips spawning when the file list is empty", async () => {
    //#given an empty file list
    let spawned = false
    const fn = (() => {
      spawned = true
      return completedProcess("", "", 0)
    }) as unknown as SpawnFn

    //#when scanning
    const result = await runSgScan(request({ files: [] }), fn)

    //#then no process is spawned and the result is empty
    expect(spawned).toBe(false)
    expect(result).toEqual({ matches: [], timedOut: false, stderr: "", truncated: false })
  })

  test("caps matches at 500 per batch and flags truncation", async () => {
    //#given 501 match lines
    const stdout = Array.from({ length: 501 }, (_, index) => matchLine(index)).join("\n")
    const calls: FakeCall[] = []

    //#when scanning
    const result = await runSgScan(request(), scanFake(stdout, "", 0, calls))

    //#then only 500 matches survive and truncation is reported
    expect(result.matches).toHaveLength(500)
    expect(result.truncated).toBe(true)
    expect(result.matches[499]?.text).toBe("// comment 499")
  })

  test("retries a file alone when its stream line is malformed", async () => {
    const calls: FakeCall[] = []
    const spawnFn = fakeSpawnFor((argv) => {
      if (argv[1] === "--version") return completedProcess("ast-grep 0.40.5\n", "", 0)
      const files = argv.slice(argv.indexOf("--json=stream") + 1)
      if (files.length > 1) return completedProcess('{"partial":', "", 0)
      return completedProcess(matchLine(0).replace("sample.ts", files[0] ?? ""), "", 0)
    }, calls)

    const result = await runSgScan(request({ files: ["a.ts", "b.ts"] }), spawnFn)

    expect(result.matches).toHaveLength(2)
    expect(result.stderr).not.toContain("Malformed")
  })

  test("does not retry per file when the cause is truncation", async () => {
    //#given 20 files whose combined output exceeds the stdout byte cap
    const calls: FakeCall[] = []
    const big = `// ${"a".repeat(300 * 1024)}`
    const stdout = Array.from({ length: 20 }, (_, index) =>
      matchLine(index).replace(`// comment ${index}`, big),
    ).join("\n")
    const spawnFn = scanFake(stdout, "", 0, calls)
    const files = Array.from({ length: 20 }, (_, index) => `f${index}.ts`)

    //#when the scan truncates
    const result = await runSgScan(request({ files, onSpawn: () => true }), spawnFn)

    //#then no per-file retries run and truncation is still reported
    expect(calls.filter((call) => call.argv[1] === "scan")).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  test("counts every per-file retry through onSpawn", async () => {
    //#given a malformed multi-file line and three valid single-file retries
    const calls: FakeCall[] = []
    let spawns = 0
    const spawnFn = fakeSpawnFor((argv) => {
      if (argv[1] === "--version") return completedProcess("ast-grep 0.40.5\n", "", 0)
      const files = scanFilesFrom(argv)
      if (files.length > 1) return completedProcess('{"partial":', "", 0)
      return completedProcess(matchLine(0).replace("sample.ts", files[0] ?? ""), "", 0)
    }, calls)

    //#when the scan retries the three missing files
    const result = await runSgScan(
      request({
        files: ["a.ts", "b.ts", "c.ts"],
        onSpawn: () => {
          spawns += 1
          return true
        },
      }),
      spawnFn,
    )

    //#then the initial spawn and all three retries are counted
    expect(spawns).toBe(4)
    expect(result.matches).toHaveLength(3)
  })

  test("stops retrying when the spawn budget is exhausted", async () => {
    //#given a budget of two spawns and five retry candidates
    const calls: FakeCall[] = []
    let budget = 2
    const spawnFn = fakeSpawnFor((argv) => {
      if (argv[1] === "--version") return completedProcess("ast-grep 0.40.5\n", "", 0)
      const files = scanFilesFrom(argv)
      if (files.length > 1) return completedProcess('{"partial":', "", 0)
      return completedProcess(matchLine(0).replace("sample.ts", files[0] ?? ""), "", 0)
    }, calls)

    //#when the scan retries
    const result = await runSgScan(
      request({
        files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        onSpawn: () => {
          if (budget <= 0) return false
          budget -= 1
          return true
        },
      }),
      spawnFn,
    )

    //#then no more than two scans run and the budget stop is reported once
    expect(calls.filter((call) => call.argv[1] === "scan")).toHaveLength(2)
    expect(result.stderr).toContain("retry budget exhausted; findings may be incomplete")
  })

  test("caps per-file retries at eight even when budget remains", async () => {
    const calls: FakeCall[] = []
    const spawnFn = fakeSpawnFor((argv) => {
      if (argv[1] === "--version") return completedProcess("ast-grep 0.40.5\n", "", 0)
      const files = scanFilesFrom(argv)
      if (files.length > 1) return completedProcess('{"partial":', "", 0)
      return completedProcess(matchLine(0).replace("sample.ts", files[0] ?? ""), "", 0)
    }, calls)
    const files = Array.from({ length: 20 }, (_, index) => `f${index}.ts`)

    const result = await runSgScan(request({ files, onSpawn: () => true }), spawnFn)

    expect(calls.filter((call) => call.argv[1] === "scan")).toHaveLength(9)
    expect(result.matches).toHaveLength(8)
    expect(result.stderr).toContain("Malformed")
  })

  test("returns a rule-parse sentinel instead of throwing on invalid rules", async () => {
    //#given sg exits non-zero with a rule-parse error on stderr
    const calls: FakeCall[] = []
    const spawnFn = scanFake("", JAVA_RULE_PARSE_STDERR, 9, calls)

    //#when scanning java with an invalid kind
    const result = await runSgScan(request({ rules: JAVA_RULES }), spawnFn)

    //#then it resolves with the stderr preserved and no truncation or timeout
    expect(result.matches).toHaveLength(0)
    expect(result.timedOut).toBe(false)
    expect(result.truncated).toBe(false)
    expect(isRuleParseError(result.stderr)).toBe(true)
  })

  test("reports a timeout and kills the process", async () => {
    //#given a process that never exits
    const calls: FakeCall[] = []
    let killed = false
    const spawnFn = fakeSpawnFor(
      (argv) =>
        argv[1] === "--version"
          ? completedProcess("ast-grep 0.40.5\n", "", 0)
          : hangingProcess(() => {
              killed = true
            }),
      calls,
    )

    //#when scanning with a tiny timeout
    const result = await runSgScan(request({ timeoutMs: 5 }), spawnFn)

    //#then the timeout is surfaced and the process is killed
    expect(result.timedOut).toBe(true)
    expect(result.matches).toHaveLength(0)
    expect(killed).toBe(true)
  })
})

describe("resolveSgBinary", () => {
  test("skips a candidate that fails the version probe and uses the next usable one", async () => {
    //#given the first candidate fails --version and the second reports ast-grep
    const calls: FakeCall[] = []
    const spawnFn = fakeSpawnFor(
      (argv) =>
        argv[0] === "/fake/corrupt-sg"
          ? completedProcess("junk", "boom", 1)
          : completedProcess("ast-grep 0.40.5\n", "", 0),
      calls,
    )

    //#when resolving from both candidates
    const resolved = await resolveSgBinary(spawnFn, ["/fake/corrupt-sg", "/fake/working-sg"])

    //#then the unusable candidate is skipped and the usable one wins
    expect(resolved).toBe("/fake/working-sg")
    expect(calls.map((call) => call.argv[0])).toEqual(["/fake/corrupt-sg", "/fake/working-sg"])
  })

  test("throws SgUnavailableError instead of returning an empty scan when every candidate fails", async () => {
    //#given both candidates fail the version probe
    const calls: FakeCall[] = []
    const spawnFn = fakeSpawnFor(() => completedProcess("junk", "boom", 1), calls)

    //#when resolving
    const error = await captureError(resolveSgBinary(spawnFn, ["/fake/a", "/fake/b"]))

    //#then a typed error names the rejected candidates
    expect(error).toBeInstanceOf(SgUnavailableError)
    expect(error instanceof Error ? error.message : "").toContain("2")
  })

  test("prefers the packaged binary over the cached binary when both probe clean", async () => {
    //#given a spawn fn that reports every candidate as usable
    const calls: FakeCall[] = []
    const spawnFn = fakeSpawnFor(() => completedProcess("ast-grep 0.40.5\n", "", 0), calls)

    //#when resolving through the default chain
    const resolved = await resolveSgBinary(spawnFn)
    const packaged = findPackagedSgBinary()

    //#then the version-pinned packaged dependency wins before the cache is probed
    expect(packaged).not.toBeNull()
    expect(resolved).toBe(packaged)
    expect(calls).toHaveLength(1)
  })

  test("leaves cache environment variables untouched", async () => {
    //#given a snapshot of the cache-related environment keys
    const keys = ["XDG_CACHE_HOME", "LOCALAPPDATA", "APPDATA"] as const
    const before = keys.map((key) => process.env[key])
    const spawnFn = fakeSpawnFor(() => completedProcess("ast-grep 0.40.5\n", "", 0), [])

    //#when resolving a binary
    await resolveSgBinary(spawnFn)

    //#then no environment key changed
    expect(keys.map((key) => process.env[key])).toEqual(before)
  })

  test("returns null when Bun.resolveSync cannot find the package", () => {
    //#given a base directory with no node_modules
    const dir = mkdtempSync(join(tmpdir(), "matrixx-no-package-"))

    try {
      //#when resolving the packaged binary from that base
      const resolved = findPackagedSgBinary(dir)

      //#then it yields null without throwing
      expect(resolved).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("memoises the version probe per path across repeated runSgScan calls", async () => {
    //#given one spawn fn reused for two scans
    const calls: FakeCall[] = []
    const spawnFn = scanFake("", "", 0, calls)

    //#when scanning twice
    await runSgScan(request(), spawnFn)
    await runSgScan(request(), spawnFn)

    //#then the binary is probed once and then reused
    const probes = calls.filter((call) => call.argv[1] === "--version")
    const scans = calls.filter((call) => call.argv[1] === "scan")
    expect(probes).toHaveLength(1)
    expect(scans).toHaveLength(2)
  })
})

describe("isRuleParseError", () => {
  test("recognizes the verified java invalid-kind stderr", () => {
    expect(isRuleParseError(JAVA_RULE_PARSE_STDERR)).toBe(true)
  })

  test("recognizes malformed yaml rule errors", () => {
    const stderr = [
      "Error: Cannot parse rule INLINE_RULES",
      "╰▻ Fail to parse yaml as RuleConfig",
      "╰▻ did not find expected ',' or ']'",
    ].join("\n")
    expect(isRuleParseError(stderr)).toBe(true)
  })

  test("does not treat missing files or empty scans as rule-parse errors", () => {
    expect(isRuleParseError("ERROR: nope.ts: No such file or directory (os error 2)")).toBe(false)
    expect(isRuleParseError("No files found")).toBe(false)
    expect(isRuleParseError("")).toBe(false)
  })
})

describe("SgUnavailableError", () => {
  test("is a typed Error carrying its own name", () => {
    const error = new SgUnavailableError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("SgUnavailableError")
    expect(error.message).toContain("sg")
  })
})

const requireFromTest = createRequire(import.meta.url)

function hasAstGrepPackage(): boolean {
  try {
    requireFromTest.resolve("@ast-grep/cli/package.json")
    return true
  } catch {
    return false
  }
}

function resolvePackageBinary(): string | null {
  try {
    const packageJson = requireFromTest.resolve("@ast-grep/cli/package.json")
    const candidate = join(dirname(packageJson), process.platform === "win32" ? "sg.exe" : "sg")
    return existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

const astGrepPackagePresent = hasAstGrepPackage()
const realBinaryTest = astGrepPackagePresent || process.env.CI ? test : test.skip

const realBinaryDirs: string[] = []

afterAll(() => {
  for (const dir of realBinaryDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

realBinaryTest("scans a real TypeScript file and surfaces a java rule-parse error", async () => {
  //#given the pinned ast-grep package is installed and its binary exists
  const packageBinary = resolvePackageBinary()
  expect(packageBinary).not.toBeNull()
  expect(existsSync(packageBinary ?? "")).toBe(true)
  expect(findPackagedSgBinary()).toBe(packageBinary)

  const dir = mkdtempSync(join(tmpdir(), "matrixx-sg-invoke-"))
  realBinaryDirs.push(dir)
  writeFileSync(join(dir, "sample.ts"), "int x = 1; // trailing\n// standalone\nconst s = \"http://x\"\n")
  writeFileSync(join(dir, "Sample.java"), "public class A {\n  // hi\n  int x = 1;\n}\n")

  //#when scanning a real TypeScript file
  const tsResult = await runSgScan({ rules: TS_RULES, files: ["sample.ts"], cwd: dir, timeoutMs: 20000 })

  //#then the comment nodes come back with 0-based ranges
  expect(tsResult.timedOut).toBe(false)
  expect(tsResult.matches).toHaveLength(2)
  expect(tsResult.matches[0]?.text).toBe("// trailing")
  expect(tsResult.matches[0]?.range.start.line).toBe(0)
  expect(tsResult.matches[0]?.charCount.leading).toBe(11)
  expect(tsResult.matches[1]?.range.start.line).toBe(1)

  //#when scanning java with the unsupported comment kind
  const javaResult = await runSgScan({
    rules: JAVA_RULES,
    files: ["Sample.java"],
    cwd: dir,
    timeoutMs: 20000,
  })

  //#then sg fails to parse the rule and the sentinel detects it
  expect(javaResult.matches).toHaveLength(0)
  expect(javaResult.timedOut).toBe(false)
  expect(javaResult.truncated).toBe(false)
  expect(isRuleParseError(javaResult.stderr)).toBe(true)
})
