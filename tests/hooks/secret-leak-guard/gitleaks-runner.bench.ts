// Bench for P3b: an unchanged staged set must cost one gitleaks scan, not N.
// Run with `bun tests/hooks/secret-leak-guard/gitleaks-runner.bench.ts`.
import {
  formatTimingStats,
  timeAsync,
} from "../../perf/bench-utils"
import {
  type GitleaksScanSpawn,
  _resetGitleaksRunnerForTesting,
  _setGitleaksAvailableForTesting,
  _setScanSpawnForTesting,
  _setStagedFingerprintForTesting,
  runGitleaksStagedScan,
} from "../../../src/hooks/secret-leak-guard/gitleaks-runner"

const SCAN_LATENCY_MS = 20
const ITERATIONS = 20
const CWD = "/bench/repo"

interface TimedScan {
  spawn: GitleaksScanSpawn
  calls: () => number
}

function createTimedScan(latencyMs: number): TimedScan {
  let calls = 0
  const spawn: GitleaksScanSpawn = () => {
    calls += 1
    return {
      exited: new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), latencyMs)
      }),
      stdout: new Response("[]").body as ReadableStream<Uint8Array>,
      kill: () => {},
    }
  }
  return { spawn, calls: () => calls }
}

async function measure(cached: boolean) {
  _resetGitleaksRunnerForTesting()
  _setGitleaksAvailableForTesting(true)
  _setStagedFingerprintForTesting(cached ? async () => "stable-staged-set" : async () => null)
  const scan = createTimedScan(SCAN_LATENCY_MS)
  _setScanSpawnForTesting(scan.spawn)
  const stats = await timeAsync(() => runGitleaksStagedScan(CWD), ITERATIONS)
  return { stats, scans: scan.calls() }
}

async function main() {
  console.log(
    `gitleaks staged-scan bench: simulated scan=${SCAN_LATENCY_MS}ms iters=${ITERATIONS} warmup=auto`,
  )
  const before = await measure(false)
  const after = await measure(true)
  console.log(`before_uncached ${formatTimingStats("", before.stats).trim()} scans=${before.scans}`)
  console.log(`after_cached   ${formatTimingStats("", after.stats).trim()} scans=${after.scans}`)
  const drop = before.stats.p50 === 0 ? 0 : (before.stats.p50 - after.stats.p50) / before.stats.p50
  console.log(
    `unchanged_staged_set scans_before=${before.scans} scans_after=${after.scans} ` +
      `p50_drop_pct=${(drop * 100).toFixed(2)}`,
  )
  if (after.scans !== 1) {
    throw new Error(`expected exactly 1 scan for an unchanged staged set, saw ${after.scans}`)
  }
  if (drop < 0.1) {
    throw new Error(`expected >=10% p50 drop, saw ${(drop * 100).toFixed(2)}%`)
  }
}

await main()
