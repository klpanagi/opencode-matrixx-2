/**
 * T4 benchmark for `tool.execute.after` (plan item P2b).
 *
 * The handler keeps the original invocation order; the change is that
 * consecutive pure observers now overlap inside a wave instead of paying one
 * serial await each, and every wave is drained before the next sequential
 * hook runs.
 *
 * Sequential lanes:  toolOutputTruncator, qualityGate, then the output
 *                    mutators (webfetchRedirectGuard, emptyTaskResponseDetector,
 *                    niobeHook, taskResumeInfo, taskNotepadWriter,
 *                    hashlineReadEnhancer), then sessionMemory.
 * Observer waves:    {contextWindowMonitor, commentChecker,
 *                     directoryAgentsInjector, rulesInjector}
 *                    {agentUsageReminder, categorySkillReminder,
 *                     interactiveBashSession, editErrorRecovery}
 *                    {jsonErrorRecovery, readImageResizer, silentFailureGuard}
 *
 * Stub shape: every hook waits one timer turn (`setTimeout(..., 0)`, ~1ms on
 * this host), the latency shape of a post-hook that waits on fs/SDK I/O. The
 * measured delta is therefore the number of serialized turns the change
 * removes (19 -> 12), not stub arithmetic.
 * `dispatchLegacy` is the pre-T4 shape (18 sequential awaits through the same
 * per-hook isolation wrapper, qualityGate concurrent with the chain) run in the
 * same process against the same stubs. Samples are interleaved in alternating
 * blocks (4 blocks x 25 dispatches per shape) so a drift in host load cannot
 * favour one side.
 *
 * Host-independent metric: the peak concurrency asserted in the structural
 * test (widest wave = 4, sequential peak = 1) plus the turn count printed with
 * the timing line.
 *
 * Run: `bun test ./tests/plugin/tool/tool-execute-after.bench.ts`
 */
import { describe, expect, test } from "bun:test"

import type { DomainHooks } from "../../../src/plugin/setup-domains"
import { createToolExecuteAfterHandler } from "../../../src/plugin/tool/tool-execute-after"
import {
  formatTimingStats,
  percentile,
  timeAsync,
  type TimingStats,
} from "../../perf/bench-utils"

type AfterHook = (input: BenchInput, output: BenchOutput) => Promise<void>
type BenchInput = { tool: string; sessionID: string; callID: string }
type BenchOutput = { title: string; output: string; metadata: Record<string, unknown> }

const BLOCKS = 4
const ITERS_PER_BLOCK = 25
const WARMUP_ITERS = 10

const LEADING = ["toolOutputTruncator", "qualityGate"] as const

const MUTATORS = [
  "webfetchRedirectGuard",
  "emptyTaskResponseDetector",
  "niobeHook",
  "taskResumeInfo",
  "taskNotepadWriter",
  "hashlineReadEnhancer",
] as const

const TAIL = ["sessionMemory"] as const

const OBSERVER_WAVES = [
  ["contextWindowMonitor", "commentChecker", "directoryAgentsInjector", "rulesInjector"],
  ["agentUsageReminder", "categorySkillReminder", "interactiveBashSession", "editErrorRecovery"],
  ["jsonErrorRecovery", "readImageResizer", "silentFailureGuard"],
] as const

const OBSERVERS: readonly string[] = OBSERVER_WAVES.flat()
const CHAIN = [
  "webfetchRedirectGuard",
  "contextWindowMonitor",
  "commentChecker",
  "directoryAgentsInjector",
  "rulesInjector",
  "emptyTaskResponseDetector",
  "agentUsageReminder",
  "categorySkillReminder",
  "interactiveBashSession",
  "editErrorRecovery",
  "niobeHook",
  "taskResumeInfo",
  "taskNotepadWriter",
  "hashlineReadEnhancer",
  "jsonErrorRecovery",
  "readImageResizer",
  "silentFailureGuard",
  "sessionMemory",
] as const
const ALL_HOOKS = [...LEADING, ...CHAIN]
const WIDEST_WAVE = Math.max(...OBSERVER_WAVES.map((wave) => wave.length))

const yieldTurn = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

function buildHooks(stubFor: (name: string) => AfterHook): DomainHooks {
  const hooks: Record<string, { "tool.execute.after": AfterHook }> = {}
  for (const name of ALL_HOOKS) hooks[name] = { "tool.execute.after": stubFor(name) }
  return hooks as unknown as DomainHooks
}

function afterLookup(hooks: DomainHooks): Record<string, AfterHook | undefined> {
  const table = hooks as unknown as Record<string, { "tool.execute.after": AfterHook } | undefined>
  const after: Record<string, AfterHook | undefined> = {}
  for (const name of ALL_HOOKS) after[name] = table[name]?.["tool.execute.after"]
  return after
}

async function legacySlot(
  fn: AfterHook | undefined,
  input: BenchInput,
  output: BenchOutput,
): Promise<void> {
  if (!fn) return
  await fn(input, output)
}

function summarize(samples: readonly number[]): TimingStats {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    iters: sorted.length,
    warmupIters: 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length === 0 ? 0 : sum / sorted.length,
    samples: sorted,
  }
}

describe("tool.execute.after T4 (observer waves)", () => {
  test("one dispatch: mutators stay exclusive, observers share their wave", async () => {
    //#given hooks that count how many of their class are in flight
    let activeSequential = 0
    let activeObserver = 0
    let peakSequential = 0
    let peakObserver = 0
    const hooks = buildHooks((name) => {
      const observer = OBSERVERS.includes(name)
      return async () => {
        if (observer) {
          activeObserver++
          peakObserver = Math.max(peakObserver, activeObserver)
        } else {
          activeSequential++
          peakSequential = Math.max(peakSequential, activeSequential)
        }
        await yieldTurn()
        if (observer) activeObserver--
        else activeSequential--
      }
    })
    const handler = createToolExecuteAfterHandler({ hooks })

    //#when the handler dispatches
    await handler(
      { tool: "t4", sessionID: "ses_t4", callID: "call_t4" },
      { title: "t", output: "o", metadata: {} },
    )

    //#then sequential hooks never overlapped and the widest observer wave did
    expect(peakSequential).toBe(1)
    expect(peakObserver).toBe(WIDEST_WAVE)
  })

  test(
    "interleaved A/B: p50 against the pre-T4 sequential dispatch",
    async () => {
      //#given the same one-turn stubs behind both dispatch shapes
      const hooks = buildHooks(() => async () => {
        await yieldTurn()
      })
      const legacyAfter = afterLookup(hooks)
      const dispatchLegacy = async (): Promise<void> => {
        const input = { tool: "bench", sessionID: "ses_bench", callID: "call_bench" }
        const output = { title: "t", output: "o", metadata: {} }
        await legacySlot(legacyAfter.toolOutputTruncator, input, output)
        await Promise.all([
          legacySlot(legacyAfter.qualityGate, input, output),
          (async () => {
            for (const name of CHAIN) await legacySlot(legacyAfter[name], input, output)
          })(),
        ])
      }
      const handler = createToolExecuteAfterHandler({ hooks })
      const input = { tool: "bench", sessionID: "ses_bench", callID: "call_bench" }
      const dispatchWave = (): Promise<void> =>
        handler(input, { title: "t", output: "o", metadata: {} })

      for (let i = 0; i < WARMUP_ITERS; i++) {
        await dispatchLegacy()
        await dispatchWave()
      }

      //#when both shapes are sampled in alternating blocks
      const beforeSamples: number[] = []
      const afterSamples: number[] = []
      for (let block = 0; block < BLOCKS; block++) {
        const first = block % 2 === 0 ? "before" : "after"
        for (const which of first === "before" ? ["before", "after"] : ["after", "before"]) {
          const stats = await timeAsync(which === "before" ? dispatchLegacy : dispatchWave, ITERS_PER_BLOCK)
          const target = which === "before" ? beforeSamples : afterSamples
          target.push(...stats.samples)
        }
      }

      const before = summarize(beforeSamples)
      const after = summarize(afterSamples)
      const improvement = (before.p50 - after.p50) / before.p50

      //#then the serialized turns the change removes show up in the median
      console.log(
        `${formatTimingStats("T4_BEFORE tool_execute_after", before)} ` +
          `hooks=${ALL_HOOKS.length} sequential=${LEADING.length + MUTATORS.length + TAIL.length} ` +
          `observer_waves=${OBSERVER_WAVES.length} event_loop_turns=19`,
      )
      console.log(
        `${formatTimingStats("T4_AFTER tool_execute_after", after)} ` +
          `hooks=${ALL_HOOKS.length} sequential=${LEADING.length + MUTATORS.length + TAIL.length} ` +
          `observer_waves=${OBSERVER_WAVES.length} peak_concurrency=${WIDEST_WAVE} ` +
          `event_loop_turns=12 p50_improvement_pct=${(improvement * 100).toFixed(1)}`,
      )
      expect(improvement).toBeGreaterThanOrEqual(0.1)
    },
    30_000,
  )
})
