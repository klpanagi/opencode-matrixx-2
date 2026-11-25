/**
 * T11 / P8 benchmark: comment-scan temp-dir lifecycle.
 *
 * Before P8, every `scanAstSources()` call created a private directory
 * (`mkdtempSync` + `chmodSync`), materialized its sources there, and then
 * `rmSync`'d the whole tree. After P8 the AST tier owns ONE process-lifetime
 * directory, created lazily on the first scan and removed at dispose; each
 * scan gets a token in its file names so the `wx` flag never collides.
 *
 * Two host-independent facts are asserted:
 *   - N scans cause exactly one `mkdtempSync` (the exported creation counter).
 *   - every scan writes into the same directory.
 *
 * The wall-clock comparison is the removed lifecycle (per-scan
 * mkdtemp/chmod/write/rm) versus the shared-dir write, so the benchmark does
 * not depend on the real `sg` binary.
 *
 * Run with: `bun test tests/shared/comment-scan/ast-scan.bench.ts`
 *
 * Intentionally NOT named `*.test.ts`: CI's `find ... -name '*.test.ts'`
 * sweep must not pick it up; the perf row in `tests/perf/BASELINE.md`
 * records the numbers.
 */
import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  disposeCommentScanTempDir,
  getTempDirCreationCount,
  scanAstSources,
} from "../../../src/shared/comment-scan/ast-scan"
import {
  DEFAULT_MAX_FINDINGS,
  DEFAULT_SG_TIMEOUT_MS,
} from "../../../src/shared/comment-scan/constants"
import type { ScanSource } from "../../../src/shared/comment-scan/types"
import { formatTimingStats, time, timeAsync } from "../../perf/bench-utils"

type SpawnFn = typeof import("bun").spawn

const OPTIONS = { timeoutMs: DEFAULT_SG_TIMEOUT_MS, maxFindings: DEFAULT_MAX_FINDINGS }
const FILE_COUNT = 4
const SCAN_ITERATIONS = 40
const LIFECYCLE_ITERATIONS = 100
const TEMP_DIR_MODE = 0o700
const TEMP_FILE_MODE = 0o600
const LEGACY_TEMP_PREFIX = "matrixx-comment-scan-legacy-bench-"

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

function scanFiles(argv: readonly string[]): readonly string[] {
  const marker = argv.indexOf("--json=stream")
  return marker < 0 ? [] : argv.slice(marker + 1)
}

/** Fake `sg` that resolves the version probe and returns no findings. */
function fakeScan(onScan?: (files: readonly string[]) => void): SpawnFn {
  const fn = (argv: string[]) => {
    if (argv[1] === "--version") return completedProcess("ast-grep 0.40.5\n", "", 0)
    const files = scanFiles(argv)
    onScan?.(files)
    return completedProcess("", "", 0)
  }
  return fn as unknown as SpawnFn
}

function makeSources(prefix: string): readonly ScanSource[] {
  return Array.from({ length: FILE_COUNT }, (_, index) => ({
    filePath: `${prefix}-${index}.ts`,
    text: `// ${prefix} ${index}\n`,
  }))
}

let legacyToken = 0

/** Verbatim pre-P8 lifecycle: private dir per scan, writes, then full removal. */
function legacyPerScanTempDir(): void {
  const token = legacyToken
  legacyToken += 1
  const dir = mkdtempSync(join(tmpdir(), LEGACY_TEMP_PREFIX))
  chmodSync(dir, TEMP_DIR_MODE)
  try {
    for (let index = 0; index < FILE_COUNT; index++) {
      writeFileSync(join(dir, `src-${token}-${index}-module.ts`), "// c\n", {
        mode: TEMP_FILE_MODE,
        flag: "wx",
      })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let sharedToken = 0

/** Post-P8 lifecycle: write into the already-created process-lifetime dir. */
function sharedDirPerScanWrite(dir: string): void {
  const token = sharedToken
  sharedToken += 1
  for (let index = 0; index < FILE_COUNT; index++) {
    writeFileSync(join(dir, `src-${token}-${index}-module.ts`), "// c\n", {
      mode: TEMP_FILE_MODE,
      flag: "wx",
    })
  }
}

/** Run one scan only to discover the shared dir, then return it. */
async function seedSharedDir(): Promise<string> {
  let sharedDir = ""
  const capture = fakeScan((files) => {
    if (sharedDir === "" && files[0] !== undefined) sharedDir = dirname(files[0])
  })
  await scanAstSources(makeSources("seed"), OPTIONS, capture)
  if (sharedDir === "") throw new Error("bench: shared temp dir was not created")
  return sharedDir
}

describe("comment-scan temp-dir lifecycle (P8)", () => {
  test("N scans create one mkdtemp dir and reuse it", async () => {
    //#given a clean process-lifetime dir
    disposeCommentScanTempDir()
    const dirs: string[] = []
    const spawn = fakeScan((files) => {
      const first = files[0]
      if (first !== undefined) dirs.push(dirname(first))
    })
    const creationsBefore = getTempDirCreationCount()

    //#when
    const stats = await timeAsync(
      () => scanAstSources(makeSources("reuse"), OPTIONS, spawn),
      SCAN_ITERATIONS,
    )

    //#then
    const creations = getTempDirCreationCount() - creationsBefore
    console.log(
      `${formatTimingStats("P8_AFTER shared_dir_scan", stats)} ` +
        `mkdtemp_created=${creations} scans=${SCAN_ITERATIONS} files_per_scan=${FILE_COUNT}`,
    )
    expect(creations).toBe(1)
    expect(new Set(dirs).size).toBe(1)
    disposeCommentScanTempDir()
  })

  test("dispose removes the shared dir so a later scan starts clean", async () => {
    //#given
    disposeCommentScanTempDir()
    let sharedDir = ""
    const spawn = fakeScan((files) => {
      const first = files[0]
      if (first !== undefined) sharedDir = dirname(first)
    })
    await scanAstSources(makeSources("dispose"), OPTIONS, spawn)
    expect(existsSync(sharedDir)).toBe(true)

    //#when
    disposeCommentScanTempDir()

    //#then
    expect(existsSync(sharedDir)).toBe(false)
  })

  test("shared-dir writes beat a per-scan mkdtemp/chmod/rm lifecycle", async () => {
    //#given
    disposeCommentScanTempDir()
    const sharedDir = await seedSharedDir()

    //#when
    const before = time(legacyPerScanTempDir, LIFECYCLE_ITERATIONS)
    const after = time(() => sharedDirPerScanWrite(sharedDir), LIFECYCLE_ITERATIONS)

    //#then
    console.log(formatTimingStats("P8_BEFORE per_scan_temp_dir", before))
    console.log(formatTimingStats("P8_AFTER shared_temp_dir", after))
    expect(after.p50).toBeLessThan(before.p50)
    disposeCommentScanTempDir()
  })
})
