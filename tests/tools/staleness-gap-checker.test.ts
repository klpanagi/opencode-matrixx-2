/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createStalenessGapCheckerTool } from "../../src/tools/staleness-gap-checker"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "staleness-gap-checker")

type Gap = { kind: string; fromSeq: number; toSeq: number; missing?: number }
type Staleness = { symbol: string; exchange: string; ageMs: number; state: string }
type Result = { status: 0 | 1 | 2; gaps: Gap[]; staleness: Staleness[]; summary: { gaps: number; stale: number } }

async function check(args: Record<string, unknown>): Promise<Result> {
  const tool = createStalenessGapCheckerTool({ directory: FIXTURES } as unknown as PluginInput)
  const output = await tool.staleness_gap_check.execute(args)
  return JSON.parse(output) as Result
}

const sample = (seq: number, exchangeTs: number, pubTs = exchangeTs) => ({
  symbol: "BTC/USDT:USDT",
  exchange: "binance",
  seq,
  exchange_ts: exchangeTs,
  pub_ts: pubTs,
})

describe("staleness_gap_check", () => {
  test("flags a seq gap", async () => {
    //#given a symbol whose sequence jumps 2 -> 4
    const samples = [sample(1, 0), sample(2, 1000), sample(4, 2000)]

    //#when the checker runs
    const result = await check({ samples })

    //#then the gap is reported with the count of missing seqs
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0].kind).toBe("gap")
    expect(result.gaps[0].missing).toBe(1)
    expect(result.status).toBe(1)
  })

  test("flags a seq regression as an error", async () => {
    //#given a sequence that moves backwards
    const samples = [sample(1, 0), sample(3, 1000), sample(2, 2000)]

    //#when the checker runs
    const result = await check({ samples })

    //#then regression is an error
    expect(result.gaps.some((g) => g.kind === "regression")).toBe(true)
    expect(result.status).toBe(2)
  })

  test("flags a duplicate seq", async () => {
    //#given a repeated sequence number
    const samples = [sample(1, 0), sample(1, 1000)]

    //#when the checker runs
    const result = await check({ samples })

    //#then duplicate is reported
    expect(result.gaps.some((g) => g.kind === "duplicate")).toBe(true)
    expect(result.status).toBe(1)
  })

  test("marks staleness stale when age exceeds 5x the expected interval", async () => {
    //#given two samples 1s apart and a now long after the last sample
    const samples = [sample(1, 0), sample(2, 1000)]

    //#when the checker runs with now = 100s
    const result = await check({ samples, now: 100_000 })

    //#then the series is stale with age measured from the last exchange_ts
    const entry = result.staleness[0]
    expect(entry.state).toBe("stale")
    expect(entry.ageMs).toBe(99_000)
    expect(result.status).toBe(2)
  })

  test("marks staleness warn between 2x and 5x", async () => {
    //#given two samples 1s apart and now 2.5s after the last sample
    const samples = [sample(1, 0), sample(2, 1000)]

    //#when the checker runs
    const result = await check({ samples, now: 3500 })

    //#then it is a warning, not stale
    expect(result.staleness[0].state).toBe("warn")
    expect(result.status).toBe(1)
  })

  test("marks staleness healthy when fresh", async () => {
    //#given a fresh series
    const samples = [sample(1, 0), sample(2, 1000)]

    //#when now is close to the last sample
    const result = await check({ samples, now: 1200 })

    //#then it is healthy
    expect(result.staleness[0].state).toBe("healthy")
    expect(result.status).toBe(0)
  })

  test("reads newline-delimited JSON samples from a log path", async () => {
    //#given a log file with a seq gap
    //#when the checker runs against the log path
    const result = await check({ logPath: "samples.ndjson" })

    //#then the gap from the file is detected
    expect(result.gaps).toHaveLength(1)
    expect(result.summary.gaps).toBe(1)
  })

  test("reports an error result when neither samples nor logPath is provided", async () => {
    //#given no input source
    //#when the checker runs
    const result = await check({})

    //#then it fails closed instead of reporting a clean pass
    expect(result.status).toBe(2)
  })
})
