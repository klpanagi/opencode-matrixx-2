/**
 * T13 / P11 — connected-providers cache filesystem-op measurement.
 *
 * Plan question: does `hasConnectedProvidersCache()`
 * (`src/shared/model/connected-providers-cache.ts:65`) re-read and re-parse
 * the cache JSON on every call? The brief assumed 3 synchronous fs ops.
 *
 * Measured answer: NO. `hasConnectedProvidersCache()` performs exactly one
 * `existsSync` (a stat, not a read) and 0 `readFileSync` / `JSON.parse`.
 * The JSON read+parse lives in `readConnectedProvidersCache()` (2 fs ops +
 * 1 parse), which runs during model resolution, not on the per-message
 * `chat.message` path (`src/plugin/tool/chat-message.ts:94` calls `has`).
 *
 * Run: `bun tests/shared/model/connected-providers-cache.bench.ts`
 * (plain script; `find tests -name '*.test.ts'` does not pick it up).
 *
 * The per-call counts are asserted, so the verdict is host-independent and
 * does not rely on this machine's filesystem latency.
 */
import { spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  hasConnectedProvidersCache,
  hasProviderModelsCache,
  readConnectedProvidersCache,
  readProviderModelsCache,
} from "../../../src/shared/model/connected-providers-cache"
import * as logger from "../../../src/shared/runtime/logger"
import {
  createFsCallCounter,
  formatTimingStats,
  time,
  type FsCallCounter,
} from "../../perf/bench-utils"

const ITERS = 2000

interface FsCounts {
  readonly fsOpsPerCall: number
  readonly total: number
  readonly breakdown: Readonly<Record<string, number>>
}

interface InstrumentOptions {
  readonly exists: boolean
  readonly contents?: string
}

function instrumentFs(counter: FsCallCounter, options: InstrumentOptions): () => void {
  const realParse = JSON.parse
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((() => {
    counter.record("existsSync")
    return options.exists
  }) as typeof fs.existsSync)
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((() => {
    counter.record("readFileSync")
    return options.contents ?? ""
  }) as typeof fs.readFileSync)
  const parseSpy = spyOn(JSON, "parse").mockImplementation(((text: string) => {
    counter.record("JSON.parse")
    return realParse(text)
  }) as typeof JSON.parse)
  return () => {
    parseSpy.mockRestore()
    readSpy.mockRestore()
    existsSpy.mockRestore()
  }
}

function countPerCall(run: () => void, counter: FsCallCounter, iters: number): FsCounts {
  counter.reset()
  for (let i = 0; i < iters; i++) run()
  const breakdown: Record<string, number> = {}
  let fsOps = 0
  for (const [operation, count] of counter.counts()) {
    breakdown[operation] = count / iters
    if (operation !== "JSON.parse") fsOps += count
  }
  return { fsOpsPerCall: fsOps / iters, total: counter.total, breakdown }
}

function assertPerCall(label: string, actual: FsCounts, expected: number): void {
  if (actual.fsOpsPerCall !== expected) {
    throw new Error(
      `${label}: expected ${expected} fs op(s) per call, saw ${actual.fsOpsPerCall} ` +
        `(${JSON.stringify(actual.breakdown)})`,
    )
  }
}

function formatBreakdown(counts: FsCounts): string {
  const parts = Object.entries(counts.breakdown)
    .map(([operation, perCall]) => `${operation}/${perCall.toFixed(3)}`)
    .join(" ")
  return parts.length > 0 ? parts : "none"
}

function report(label: string, counts: FsCounts): void {
  console.log(`${label} fs_ops_per_call=${counts.fsOpsPerCall} (per_call: ${formatBreakdown(counts)})`)
}

function main(): void {
  const workDir = mkdtempSync(join(tmpdir(), "matrixx-connected-cache-bench-"))
  const cacheDir = join(workDir, "matrixx")
  mkdirSync(cacheDir, { recursive: true })

  const connectedPayload = JSON.stringify({
    connected: ["openai", "anthropic", "google"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
  const modelsPayload = JSON.stringify({
    models: { openai: ["gpt-5.2"], anthropic: ["claude-opus-4-6"] },
    connected: ["openai", "anthropic"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
  writeFileSync(join(cacheDir, "connected-providers.json"), connectedPayload)
  writeFileSync(join(cacheDir, "provider-models.json"), modelsPayload)

  const previousXdgCache = process.env.XDG_CACHE_HOME
  process.env.XDG_CACHE_HOME = workDir

  // The read functions log on every call. Logger owns real fs (P9 hand-off),
  // so silencing `log` keeps the counters and timing isolated to the cache.
  const logSpy = spyOn(logger, "log").mockImplementation(() => {})

  try {
    console.log(`== real fs, XDG_CACHE_HOME=${workDir} (host-dependent wall clock) ==`)
    console.log(formatTimingStats("hasConnectedProvidersCache", time(() => hasConnectedProvidersCache(), ITERS)))
    console.log(formatTimingStats("hasProviderModelsCache", time(() => hasProviderModelsCache(), ITERS)))
    console.log(formatTimingStats("readConnectedProvidersCache", time(() => readConnectedProvidersCache(), ITERS)))
    console.log(formatTimingStats("readProviderModelsCache", time(() => readProviderModelsCache(), ITERS)))
    console.log("")

    const counter = createFsCallCounter()

    console.log("== instrumented per-call fs ops (host-independent gate) ==")

    let restore = instrumentFs(counter, { exists: true, contents: connectedPayload })
    const hasPresent = countPerCall(() => hasConnectedProvidersCache(), counter, ITERS)
    restore()
    report("hasConnectedProvidersCache [cache present]", hasPresent)

    restore = instrumentFs(counter, { exists: false })
    const hasAbsent = countPerCall(() => hasConnectedProvidersCache(), counter, ITERS)
    restore()
    report("hasConnectedProvidersCache [cache absent]", hasAbsent)

    restore = instrumentFs(counter, { exists: true, contents: modelsPayload })
    const hasModels = countPerCall(() => hasProviderModelsCache(), counter, ITERS)
    restore()
    report("hasProviderModelsCache", hasModels)

    restore = instrumentFs(counter, { exists: true, contents: connectedPayload })
    const readConnected = countPerCall(() => readConnectedProvidersCache(), counter, ITERS)
    restore()
    report("readConnectedProvidersCache", readConnected)

    restore = instrumentFs(counter, { exists: true, contents: modelsPayload })
    const readModels = countPerCall(() => readProviderModelsCache(), counter, ITERS)
    restore()
    report("readProviderModelsCache", readModels)

    assertPerCall("hasConnectedProvidersCache [present]", hasPresent, 1)
    assertPerCall("hasConnectedProvidersCache [absent]", hasAbsent, 1)
    assertPerCall("hasProviderModelsCache", hasModels, 1)
    assertPerCall("readConnectedProvidersCache", readConnected, 2)
    assertPerCall("readProviderModelsCache", readModels, 2)
    if ((readConnected.breakdown["JSON.parse"] ?? 0) !== 1) {
      throw new Error("readConnectedProvidersCache did not parse the cache JSON once per call")
    }
    if ((hasModels.breakdown["readFileSync"] ?? 0) !== 0) {
      throw new Error("hasProviderModelsCache read the cache file; expected existsSync only")
    }
    if ((hasPresent.breakdown["readFileSync"] ?? 0) !== 0) {
      throw new Error("hasConnectedProvidersCache read the cache file; expected existsSync only")
    }
    if ((hasPresent.breakdown["JSON.parse"] ?? 0) !== 0) {
      throw new Error("hasConnectedProvidersCache parsed JSON; expected existsSync only")
    }

    console.log("")
    console.log(
      "P11 verdict=NO-OP — hasConnectedProvidersCache does not re-read or re-parse the cache: " +
        `fs_ops_per_call=${hasPresent.fsOpsPerCall} readFileSync_per_call=0 JSON.parse_per_call=0 ` +
        `(readConnectedProvidersCache fs_ops_per_call=${readConnected.fsOpsPerCall} + ` +
        `JSON.parse_per_call=${readConnected.breakdown["JSON.parse"]} is the read path)`,
    )
  } finally {
    logSpy.mockRestore()
    if (previousXdgCache !== undefined) process.env.XDG_CACHE_HOME = previousXdgCache
    else delete process.env.XDG_CACHE_HOME
    rmSync(workDir, { recursive: true, force: true })
  }
}

main()
