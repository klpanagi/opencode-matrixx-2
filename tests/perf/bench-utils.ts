/**
 * Shared harness for `tests/perf/*.bench.ts`.
 *
 * Every optimization in `.matrixx/plans/performance-optimizations.md` is gated
 * on a before/after number captured with the same code path, so the timing
 * shape lives here instead of being re-inlined per bench (the precedent
 * benches, `src/plugin/tool/tool-execute-before.bench.ts` and
 * `tests/tools/plan-create-real.bench.ts`, each carried their own copy).
 *
 * Three pieces:
 *   - `time` / `timeAsync`: warmup, then p50/p95/p99 over N samples.
 *   - `createFakeClock`: an injectable `now()` so a bench never depends on
 *     the wall clock (pass it as `time(fn, iters, { now: clock.now })`).
 *   - `createFsCallCounter` / `assertNoFsCalls`: host-independent assertions.
 *     Filesystem timings vary 1-5 ms native vs 50-500 ms on NFS/WSL, so a
 *     cache bench must also prove the call count dropped to zero.
 *
 * These helpers are intentionally dependency-free (no `bun:test` import) so a
 * bench can also be run as a plain script.
 */

/** Latency summary for one benched unit, in milliseconds. */
export interface TimingStats {
  /** Measured iterations (excludes warmup). */
  readonly iters: number
  /** Unmeasured iterations run before sampling. */
  readonly warmupIters: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly min: number
  readonly max: number
  readonly mean: number
  /** Raw samples, ascending. */
  readonly samples: readonly number[]
}

export interface TimeOptions {
  /** Unmeasured iterations before sampling. Default: `max(10, floor(iters / 10))`. */
  readonly warmup?: number
  /** Clock in milliseconds. Default: `performance.now`. */
  readonly now?: () => number
}

function defaultWarmupIters(iters: number): number {
  return Math.max(10, Math.floor(iters / 10))
}

function assertIterationCount(iters: number): void {
  if (!Number.isInteger(iters) || iters < 1) {
    throw new Error(`bench-utils: iteration count must be a positive integer, got ${iters}`)
  }
}

/**
 * Nearest-rank percentile over an ascending sample array.
 *
 * Same convention as the `tool-execute-before` precedent, so numbers stay
 * comparable with the benches already in the repo.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0
  const index = Math.min(
    sortedAscending.length - 1,
    Math.floor((p / 100) * sortedAscending.length),
  )
  return sortedAscending[index] ?? 0
}

function summarize(samples: number[], iters: number, warmupIters: number): TimingStats {
  const sorted = [...samples].sort((a, b) => a - b)
  let sum = 0
  for (const sample of sorted) sum += sample
  return {
    iters,
    warmupIters,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length === 0 ? 0 : sum / sorted.length,
    samples: sorted,
  }
}

/** Run `iters` unmeasured iterations of `fn` (JIT + first-GC amortization). */
export function warmup(fn: (iteration: number) => unknown, iters: number): void {
  assertIterationCount(iters)
  for (let i = 0; i < iters; i++) fn(i)
}

/** Async twin of {@link warmup}. */
export async function warmupAsync(
  fn: (iteration: number) => Promise<unknown>,
  iters: number,
): Promise<void> {
  assertIterationCount(iters)
  for (let i = 0; i < iters; i++) await fn(i)
}

/**
 * Benchmark a synchronous unit.
 *
 * ```ts
 * const stats = time(() => findRuleFiles(root, resolved), 500)
 * console.log(formatTimingStats("findRuleFiles", stats))
 * ```
 */
export function time(
  fn: (iteration: number) => unknown,
  iters: number,
  options: TimeOptions = {},
): TimingStats {
  assertIterationCount(iters)
  const warmupIters = options.warmup ?? defaultWarmupIters(iters)
  const now = options.now ?? performance.now
  if (warmupIters > 0) warmup(fn, warmupIters)

  const samples: number[] = new Array(iters)
  for (let i = 0; i < iters; i++) {
    const start = now()
    fn(i)
    samples[i] = now() - start
  }
  return summarize(samples, iters, warmupIters)
}

/**
 * Benchmark an asynchronous unit (one awaited call per sample).
 *
 * Use this for handler/promise-returning benches; `await` inside the sample
 * window is deliberate because the awaits are part of the measured cost.
 */
export async function timeAsync(
  fn: (iteration: number) => Promise<unknown>,
  iters: number,
  options: TimeOptions = {},
): Promise<TimingStats> {
  assertIterationCount(iters)
  const warmupIters = options.warmup ?? defaultWarmupIters(iters)
  const now = options.now ?? performance.now
  if (warmupIters > 0) await warmupAsync(fn, warmupIters)

  const samples: number[] = new Array(iters)
  for (let i = 0; i < iters; i++) {
    const start = now()
    await fn(i)
    samples[i] = now() - start
  }
  return summarize(samples, iters, warmupIters)
}

/** One-line, grep-friendly summary: `label p50_ms=… p95_ms=… p99_ms=…`. */
export function formatTimingStats(label: string, stats: TimingStats): string {
  return (
    `${label} ` +
    `p50_ms=${stats.p50.toFixed(4)} ` +
    `p95_ms=${stats.p95.toFixed(4)} ` +
    `p99_ms=${stats.p99.toFixed(4)} ` +
    `min_ms=${stats.min.toFixed(4)} ` +
    `max_ms=${stats.max.toFixed(4)} ` +
    `mean_ms=${stats.mean.toFixed(4)} ` +
    `iters=${stats.iters} ` +
    `warmup=${stats.warmupIters}`
  )
}

/** Injectable monotonic clock; start value is arbitrary (default 0). */
export interface FakeClock {
  now(): number
  /** Add `ms` and return the new value. */
  advance(ms: number): number
  /** Jump to an absolute value. */
  set(ms: number): void
}

/**
 * Deterministic clock for units that read `Date.now()` / a timer internally.
 *
 * The methods close over the value instead of using `this`, so `clock.now`
 * can be passed around as a bare function reference.
 */
export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
      return current
    },
    set: (ms: number) => {
      current = ms
    },
  }
}

/** Per-operation filesystem call tally, incremented by a bench's fake fs. */
export interface FsCallCounter {
  /** Total calls recorded across all operations. */
  readonly total: number
  record(operation: string): void
  reset(): void
  /** Snapshot of `operation -> count`. */
  counts(): ReadonlyMap<string, number>
}

export function createFsCallCounter(): FsCallCounter {
  const tally = new Map<string, number>()
  let total = 0
  return {
    get total() {
      return total
    },
    record(operation: string) {
      total++
      tally.set(operation, (tally.get(operation) ?? 0) + 1)
    },
    reset() {
      total = 0
      tally.clear()
    },
    counts() {
      return new Map(tally)
    },
  }
}

/**
 * Assert a hot path performed no filesystem calls at all.
 *
 * Throws (rather than using `expect`) so the same helper works inside a
 * `*.bench.ts`, a plain script, or a test body.
 */
export function assertNoFsCalls(counter: FsCallCounter, context = "bench"): void {
  if (counter.total === 0) return
  const breakdown = [...counter.counts()]
    .map(([operation, count]) => `${operation}=${count}`)
    .join(", ")
  throw new Error(
    `${context}: expected 0 filesystem calls, saw ${counter.total} (${breakdown})`,
  )
}
