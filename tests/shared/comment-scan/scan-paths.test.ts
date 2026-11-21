/// <reference types="bun-types" />
//#given a temporary directory tree and collect-sources spy
//#when scanPaths walks the tree and reads scannable files
//#then unsafe dirs are skipped, paths are deduped, caps truncate loudly, and reads are resilient
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scanPaths } from "../../../src/shared/comment-scan/scan"
import type { CommentFinding, ScanResult, ScanSource } from "../../../src/shared/comment-scan/types"

let root: string
let manyRoot: string
let unreadablePath: string
let fifoRoot: string
let fifoPath: string
let depthRoot: string
const hasMkfifo = spawnSync("sh", ["-c", "command -v mkfifo"], { stdio: "ignore" }).status === 0

const MANY_FILES = 250

function collectSpy(): { sources: ScanSource[]; scanAst: () => Promise<ScanResult> } {
  const sources: ScanSource[] = []
  return {
    sources,
    scanAst: async (batch) => {
      sources.push(...batch)
      return { findings: [] }
    },
  }
}

function findingsSpy(): { sources: ScanSource[]; scanAst: () => Promise<ScanResult> } {
  const sources: ScanSource[] = []
  return {
    sources,
    scanAst: async (batch) => {
      sources.push(...batch)
      const findings: CommentFinding[] = batch.map((source) => ({
        file: source.filePath,
        line: 1,
        text: "// cap",
        tier: "ast",
        isDocstring: false,
        trailing: false,
        language: "typescript",
      }))
      return { findings }
    },
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "matrixx-scan-paths-"))
  manyRoot = await mkdtemp(join(tmpdir(), "matrixx-scan-paths-many-"))
  await writeFile(join(root, "keep.ts"), "// keep\nexport const a = 1\n")
  await writeFile(join(root, "plain.txt"), "not scannable\n")
  await mkdir(join(root, "nested"))
  await writeFile(join(root, "nested", "keep.py"), "# nested\n")
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true })
  await writeFile(join(root, "node_modules", "pkg", "index.ts"), "// ignored\n")
  await mkdir(join(root, ".hidden"))
  await writeFile(join(root, ".hidden", "secret.ts"), "// ignored\n")
  await mkdir(join(root, "dist"))
  await writeFile(join(root, "dist", "built.ts"), "// ignored\n")

  unreadablePath = join(root, "unreadable.ts")
  await writeFile(unreadablePath, "// no permission\n")
  await chmod(unreadablePath, 0o000)

  fifoRoot = await mkdtemp(join(tmpdir(), "matrixx-scan-paths-fifo-"))
  fifoPath = join(fifoRoot, "pipe.sql")
  if (hasMkfifo) spawnSync("mkfifo", [fifoPath])
  await writeFile(join(fifoRoot, "ok.ts"), "// ok\n")

  depthRoot = await mkdtemp(join(tmpdir(), "matrixx-scan-paths-depth-"))
  const deepest = join(depthRoot, ...Array.from({ length: 13 }, (_, index) => `d${index + 1}`))
  await mkdir(deepest, { recursive: true })
  await writeFile(join(deepest, "deep.ts"), "// deep\n")

  await Promise.all(
    Array.from({ length: MANY_FILES }, (_, index) =>
      writeFile(join(manyRoot, `file-${String(index).padStart(4, "0")}.ts`), "// many\n"),
    ),
  )
})

afterAll(async () => {
  await chmod(unreadablePath, 0o644).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
  await rm(manyRoot, { recursive: true, force: true })
  await rm(fifoRoot, { recursive: true, force: true })
  await rm(depthRoot, { recursive: true, force: true })
})

describe("scanPaths", () => {
  test("walks directories, skips ignored dirs, and keeps only scannable extensions", async () => {
    //#given a directory with nested, ignored, and unsupported entries
    const spy = collectSpy()
    //#when scanning the directory in AST tier
    const result = await scanPaths([root], { tier: "ast", scanAst: spy.scanAst })
    //#then only top-level and nested source files are collected
    const files = spy.sources.map((source) => source.filePath)
    expect(files).toEqual([join(root, "keep.ts"), join(root, "nested", "keep.py")])
    expect(result.findings).toEqual([])
  })

  test("dedupes repeated paths before reading", async () => {
    //#given the same explicit file repeated three times
    const spy = collectSpy()
    //#when scanning the repeated list
    await scanPaths(
      [join(root, "keep.ts"), join(root, "keep.ts"), join(root, "keep.ts")],
      { tier: "ast", scanAst: spy.scanAst },
    )
    //#then exactly one source is produced
    expect(spy.sources).toHaveLength(1)
    expect(spy.sources[0]?.filePath).toBe(join(root, "keep.ts"))
  })

  test("records a read error and keeps scanning the remaining files", async () => {
    //#given one unreadable file next to a readable one
    const spy = collectSpy()
    //#when scanning both explicit paths
    const result = await scanPaths([join(root, "keep.ts"), unreadablePath], {
      tier: "ast",
      scanAst: spy.scanAst,
    })
    //#then the read failure is reported and the readable file is still scanned
    expect(spy.sources.map((source) => source.filePath)).toEqual([join(root, "keep.ts")])
    expect(result.errors?.some((error) => error.includes(unreadablePath))).toBe(true)
  })

  test("truncation is the first error and findings from scanned files are kept", async () => {
    //#given a tree larger than an injected file cap
    const spy = findingsSpy()
    //#when scanning with the lowered cap
    const result = await scanPaths([manyRoot], {
      tier: "ast",
      scanAst: spy.scanAst,
      maxScanFiles: 3,
    })
    //#then only capped files are scanned, their findings survive, and truncation leads the errors
    expect(spy.sources).toHaveLength(3)
    expect(result.findings).toHaveLength(3)
    expect(result.errors?.[0]).toContain("Scan truncated")
    expect(result.errors?.[0]).toContain("remaining files were NOT scanned")
  })

  test("the per-invocation chunk limit does not truncate the walk", async () => {
    //#given a tree larger than the 200-file sg chunk size
    const spy = collectSpy()
    //#when scanning with production caps
    const result = await scanPaths([manyRoot], { tier: "ast", scanAst: spy.scanAst })
    //#then every file is collected and nothing reports truncation
    expect(spy.sources).toHaveLength(MANY_FILES)
    expect(result.errors?.some((error) => error.includes("Scan truncated")) ?? false).toBe(false)
  })

  test("produces a deterministic order across runs", async () => {
    //#given the same directory tree
    const first = collectSpy()
    const second = collectSpy()
    //#when walking it twice
    await scanPaths([root], { tier: "ast", scanAst: first.scanAst })
    await scanPaths([root], { tier: "ast", scanAst: second.scanAst })
    //#then the collected order is identical
    expect(second.sources.map((source) => source.filePath)).toEqual(
      first.sources.map((source) => source.filePath),
    )
  })

  test("ignores paths whose language cannot be resolved", async () => {
    //#given an explicit unsupported file
    const spy = collectSpy()
    //#when scanning it
    await scanPaths([join(root, "plain.txt")], { tier: "ast", scanAst: spy.scanAst })
    //#then nothing is read or scanned
    expect(spy.sources).toEqual([])
  })

  test("skips a FIFO in a walked directory without blocking", async () => {
    //#given a walked directory containing a FIFO and one regular source
    const spy = collectSpy()

    //#when scanning it
    const result = await scanPaths([fifoRoot], { tier: "ast", scanAst: spy.scanAst })

    //#then only the regular file is read and nothing errors
    expect(spy.sources.map((source) => source.filePath)).toEqual([join(fifoRoot, "ok.ts")])
    expect(result.errors).toBeUndefined()
  }, 2000)

  test.skipIf(!hasMkfifo)("reports an explicit FIFO as not a regular file", async () => {
    //#given an explicit FIFO next to a regular source
    const spy = collectSpy()

    //#when scanning both paths
    const result = await scanPaths([fifoPath, join(fifoRoot, "ok.ts")], {
      tier: "ast",
      scanAst: spy.scanAst,
    })

    //#then the FIFO is reported instead of read and the other file is scanned
    expect(spy.sources.map((source) => source.filePath)).toEqual([join(fifoRoot, "ok.ts")])
    expect(
      result.errors?.some((error) => error.includes(fifoPath) && error.includes("not a regular file")),
    ).toBe(true)
  }, 2000)

  test("does not claim unsupported when a path error explains the empty result", async () => {
    //#given a path that does not exist
    const spy = collectSpy()

    //#when scanning it
    const result = await scanPaths([join(root, "missing.ts")], {
      tier: "ast",
      scanAst: spy.scanAst,
    })

    //#then the real error is surfaced without a misleading skipped reason
    expect(result.errors?.some((error) => error.includes("missing.ts"))).toBe(true)
    expect(result.skipped).toBeUndefined()
  })

  test("reports a depth-limit prune instead of dropping deep files silently", async () => {
    //#given a tree whose only source file sits below the walk depth limit
    const spy = collectSpy()

    //#when scanning it
    const result = await scanPaths([depthRoot], { tier: "ast", scanAst: spy.scanAst })

    //#then the file is not collected and one depth-truncation error is reported
    expect(spy.sources).toEqual([])
    const depthErrors = (result.errors ?? []).filter((error) => error.includes("depth limit 12"))
    expect(depthErrors).toHaveLength(1)
  })
})
