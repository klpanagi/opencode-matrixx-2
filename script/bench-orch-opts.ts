/**
 * Baseline / after benchmark harness for orchestration optimizations Opt-1..Opt-6.
 *
 * Per-opt micro-benchmarks printing metrics + operation COUNTS. Counts are the
 * durable metric; wall-clock is illustrative.
 *
 * CLI:
 *   bun script/bench-orch-opts.ts --opt <1..6> --mode <before|after>
 *
 * - 5 runs per invocation, reports median + min/max, line-oriented key=value.
 * - Writes evidence to .matrixx/evidence/orch-opts/opt-<N>-<mode>.txt with a
 *   header (git HEAD, timestamp, N).
 * - `--opt 4` prints an explicit "removal-exempt: no perf bench" note and exits 0
 *   (Opt-4 is dead-code removal of completionTimers; no timing metric exists).
 * - Invalid --opt / --mode prints usage to stderr and exits non-zero WITHOUT
 *   writing or clobbering any evidence file.
 *
 * Opt mapping (before-path; after-path uses the optimized export when present,
 * otherwise falls back to the before path and labels itself fallback-before):
 *   Opt-1: sweepStaleHandles + readHandles over 200 seeded handle files.
 *          Counts readdirSync + readFileSync during the measured section.
 *   Opt-2: 1000 findBySession + 100 getTasksByParentSession over 5000 tasks.
 *   Opt-3: no network. Counting fake client against fetchSessionMessages
 *          semantics; drives the two within-call fetch sites per path.
 *   Opt-5: getAllDescendantTasks over a 551-task tree; counts
 *          getTasksByParentSession invocations.
 *   Opt-6: no timing claim. Static scan for duplicated timeout literals.
 */
/// <reference types="bun-types" />

import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { ManagerStore } from "../src/features/background-agent/manager/store"
import type { BackgroundTask } from "../src/features/background-agent/types"
import type { ExecutorContext, ParentContext } from "../src/tools/delegate-task/executor-types"
import type { NativeClient, ToolContextWithMetadata } from "../src/tools/delegate-task/types"

// ---------------------------------------------------------------- CLI parsing

function parseArgs(argv: string[]): { opt: number; mode: string } | null {
  let optRaw: string | undefined
  let modeRaw: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--opt") optRaw = argv[i + 1]
    if (argv[i] === "--mode") modeRaw = argv[i + 1]
  }
  if (optRaw === undefined || modeRaw === undefined) return null
  const opt = Number(optRaw)
  if (!Number.isInteger(opt) || opt < 1 || opt > 6) return null
  if (modeRaw !== "before" && modeRaw !== "after") return null
  return { opt, mode: modeRaw }
}

function usage(): string {
  return [
    "usage: bun script/bench-orch-opts.ts --opt <1..6> --mode <before|after>",
    "",
    "  --opt 1  sweep+read single directory pass (handle-index.ts)",
    "  --opt 2  task lookup index (state.ts / store.ts)",
    "  --opt 3  within-call fetchSessionMessages dedupe (no network)",
    "  --opt 4  dead-code removal (exempt: no perf bench)",
    "  --opt 5  getAllDescendantTasks single-pass",
    "  --opt 6  timeout-literal consolidation (static scan, no timing)",
  ].join("\n")
}

// ---------------------------------------------------------------- stats helpers

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

function min(values: number[]): number {
  return Math.min(...values)
}

function max(values: number[]): number {
  return Math.max(...values)
}

function msSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

function gitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

// ---------------------------------------------------------------- evidence writer

const EVIDENCE_DIR = join(process.cwd(), ".matrixx", "evidence", "orch-opts")

function writeEvidence(opt: number, mode: string, lines: string[]): string {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const header = [
    `# opt=${opt} mode=${mode}`,
    `# git_head=${gitHead()}`,
    `# timestamp=${new Date().toISOString()}`,
    `# runs=5`,
  ]
  const body = [...header, ...lines].join("\n") + "\n"
  const filePath = join(EVIDENCE_DIR, `opt-${opt}-${mode}.txt`)
  Bun.write(filePath, body)
  return filePath
}

// ---------------------------------------------------------------- Opt-1

type FsFunc = (...args: never[]) => unknown

async function benchOpt1(mode: string): Promise<{ lines: string[]; file: string }> {
  // Patch node:fs BEFORE the SUT is imported so the measured section's
  // readdirSync/readFileSync calls are counted. Falls back to a documented
  // boundary counter when interception cannot be verified.
  const fsOrig = await import("node:fs")
  let readdirCalls = 0
  let readfileCalls = 0
  let countMethod = "fs-intercept"

  const origReaddir = fsOrig.readdirSync as unknown as FsFunc
  const origReadfile = fsOrig.readFileSync as unknown as FsFunc
  let patched = false
  try {
    const { mock } = await import("bun:test")
    mock.module("node:fs", () => ({
      ...fsOrig,
      readdirSync: (...args: never[]) => {
        readdirCalls++
        return Reflect.apply(origReaddir as (...a: unknown[]) => unknown, null, args) as unknown
      },
      readFileSync: (...args: never[]) => {
        readfileCalls++
        return Reflect.apply(origReadfile as (...a: unknown[]) => unknown, null, args) as unknown
      },
    }))
    patched = true
  } catch {
    patched = false
  }

  const handleIndex = await import("../src/features/background-agent/handle-index")
  const { sweepStaleHandles, readHandles, writeHandle, getBgHandleDir } = handleIndex
  const sweepAndRead =
    "sweepAndReadHandles" in handleIndex &&
    typeof (handleIndex as Record<string, unknown>)["sweepAndReadHandles"] === "function"
      ? ((handleIndex as Record<string, (...a: never[]) => unknown>)["sweepAndReadHandles"] as (dir: string) => unknown)
      : null

  // Probe: one sweep+read over an empty dir must produce readdir calls when
  // interception works. sweepStaleHandles + readHandles each list the dir once.
  const probeDir = mkdtempSync(join(tmpdir(), "mx-opt1-probe-"))
  mkdirSync(getBgHandleDir(probeDir), { recursive: true })
  readdirCalls = 0
  readfileCalls = 0
  sweepStaleHandles(probeDir)
  readHandles(probeDir)
  if (!patched || readdirCalls === 0) {
    countMethod = "boundary-estimated"
  }

  const N = 200
  const RUNS = 5
  const times: number[] = []
  const readdirs: number[] = []
  const readfiles: number[] = []
  let pathLabel = "sweep-then-read"
  if (mode === "after" && sweepAndRead !== null) pathLabel = "sweepAndReadHandles"

  for (let run = 0; run < RUNS; run++) {
    const dir = mkdtempSync(join(tmpdir(), `mx-opt1-${run}-`))
    const now = new Date()
    for (let i = 0; i < N; i++) {
      writeHandle(dir, {
        id: `bg_bench_${i}`,
        parentSessionID: "ses_parent",
        parentMessageID: "msg_1",
        description: `bench handle ${i}`,
        prompt: "bench",
        agent: "task",
        status: "completed",
        sessionID: `ses_child_${i}`,
        queuedAt: now,
        startedAt: now,
        completedAt: now,
      })
    }
    readdirCalls = 0
    readfileCalls = 0
    const t0 = process.hrtime.bigint()
    if (mode === "after" && sweepAndRead !== null) {
      sweepAndRead(dir)
    } else {
      sweepStaleHandles(dir)
      readHandles(dir)
    }
    times.push(msSince(t0))
    if (countMethod === "fs-intercept") {
      readdirs.push(readdirCalls)
      readfiles.push(readfileCalls)
    } else {
      // Boundary estimate, clearly labeled: sweep pass (1 readdir + N reads)
      // plus read pass (1 readdir + N reads). No file is removed (fresh
      // timestamps), so no extra generation-file churn beyond the per-handle
      // generation probe already inside each read.
      readdirs.push(2)
      readfiles.push(2 * N)
    }
  }

  const lines = [
    `opt=1`,
    `mode=${mode}`,
    `opt1_path=${pathLabel}`,
    `count_method=${countMethod}`,
    `handles=${N}`,
    `restore_median_ms=${median(times).toFixed(2)}`,
    `restore_min_ms=${min(times).toFixed(2)}`,
    `restore_max_ms=${max(times).toFixed(2)}`,
    `readdir_calls=${median(readdirs)}`,
    `readfile_calls=${median(readfiles)}`,
  ]
  return { lines, file: writeEvidence(1, mode, lines) }
}

// ---------------------------------------------------------------- Opt-2

async function benchOpt2(mode: string): Promise<{ lines: string[]; file: string }> {
  const N = 5000
  const store = new ManagerStore(join(tmpdir(), "mx-opt2-dir"))
  for (let i = 0; i < N; i++) {
    store.tasks.set(`bg_${i}`, {
      id: `bg_${i}`,
      parentSessionID: `ses_parent_${i % 500}`,
      parentMessageID: "msg_1",
      description: `task ${i}`,
      prompt: "bench",
      agent: "task",
      status: "running",
      sessionID: `ses_child_${i}`,
    })
  }
  void mode

  const counted = store.tasks as Map<string, BackgroundTask>
  const origValues = counted.values.bind(counted)
  let scanned = 0
  counted.values = function* (): IterableIterator<BackgroundTask> {
    for (const task of origValues()) {
      scanned++
      yield task
    }
  }

  const RUNS = 5
  const findTimes: number[] = []
  const parentTimes: number[] = []
  const scannedPerRun: number[] = []
  for (let run = 0; run < RUNS; run++) {
    scanned = 0
    let t0 = process.hrtime.bigint()
    for (let i = 0; i < 1000; i++) {
      // Alternate hit (existing session) and miss (unknown session).
      const sid = i % 2 === 0 ? `ses_child_${i % N}` : `ses_missing_${i}`
      store.findBySession(sid)
    }
    findTimes.push(msSince(t0))
    t0 = process.hrtime.bigint()
    for (let i = 0; i < 100; i++) {
      store.getTasksByParentSession(`ses_parent_${i % 500}`)
    }
    parentTimes.push(msSince(t0))
    scannedPerRun.push(scanned)
  }

  const lines = [
    `opt=2`,
    `mode=${mode}`,
    `tasks=${N}`,
    `find_by_session_median_ms=${median(findTimes).toFixed(3)}`,
    `find_by_session_min_ms=${min(findTimes).toFixed(3)}`,
    `find_by_session_max_ms=${max(findTimes).toFixed(3)}`,
    `tasks_by_parent_median_ms=${median(parentTimes).toFixed(3)}`,
    `tasks_by_parent_min_ms=${min(parentTimes).toFixed(3)}`,
    `tasks_by_parent_max_ms=${max(parentTimes).toFixed(3)}`,
    `tasks_scanned_per_lookup=${median(scannedPerRun)}`,
    `lookups_per_run=1000`,
    `parent_lookups_per_run=100`,
  ]
  return { lines, file: writeEvidence(2, mode, lines) }
}

// ---------------------------------------------------------------- Opt-3

async function benchOpt3(mode: string): Promise<{ lines: string[]; file: string }> {
  const { pollSyncSession } = await import('../src/tools/delegate-task/sync-session-poller')
  const { __setTimingConfig } = await import('../src/tools/delegate-task/timing')
  // No network. The carrier counts session.context calls (the transport behind
  // fetchSessionMessages) while the REAL within-call paths are driven. The
  // assistant message carries no terminal finish so isSessionComplete stays
  // false and each path reaches its final fetch.
  const messages = [
    { type: 'user', id: 'm1', content: [{ type: 'text', text: 'hello' }] },
    { type: 'assistant', id: 'm2', content: [{ type: 'text', text: 'working' }] },
  ]
  let calls = 0
  const countingSession = {
    context: (_input: { sessionID: string }): Promise<unknown> => {
      calls++
      return Promise.resolve({ messages })
    },
  }
  const client = {
    session: countingSession,
    agent: { list: async (): Promise<unknown> => [] },
    model: { list: async (): Promise<unknown> => [] },
  } as unknown as NativeClient
  const toolCtx = {
    sessionID: 'ses_parent',
    messageID: 'msg_1',
    agent: 'task',
    abort: AbortSignal.timeout(30000),
  } as unknown as ToolContextWithMetadata

  // Poller: deterministic timeout (MAX_POLL_TIME_MS=50 < POLL_INTERVAL_MS) so
  // one call performs exactly 1 loop fetch + 1 timeout-path re-fetch.
  __setTimingConfig({ POLL_INTERVAL_MS: 1000, MAX_POLL_TIME_MS: 50 })
  const RUNS = 3
  const pollerFetches: number[] = []
  try {
    for (let run = 0; run < RUNS; run++) {
      void run
      calls = 0
      await pollSyncSession(toolCtx, client, {
        sessionID: 'ses_bench',
        agentToUse: 'task',
        toastManager: null,
        taskId: undefined,
      })
      pollerFetches.push(calls)
    }
  } finally {
    __setTimingConfig({ POLL_INTERVAL_MS: 1000, MAX_POLL_TIME_MS: 600000 })
  }

  // Unstable-agent path: 2 last-poll fetches (stability gate) + 1 final fetch.
  let unstablePath = 'executeUnstableAgentTask-real'
  let unstableFetches = 'unmeasured'
  try {
    const { executeUnstableAgentTask } = await import('../src/tools/delegate-task/unstable-agent-task')
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
    try {
      const runningTask = { id: 'bg_bench', sessionID: 'ses_bench', status: 'running' }
      const fakeManager = {
        launch: async () => ({ ...runningTask }),
        getTask: () => ({ ...runningTask }),
      }
      const executorCtx = {
        manager: fakeManager,
        client,
        directory: tmpdir(),
      } as unknown as ExecutorContext
      const parentContext: ParentContext = { sessionID: 'ses_parent', messageID: 'msg_1' }
      calls = 0
      const result = await executeUnstableAgentTask(
        { description: 'bench', prompt: 'bench', run_in_background: false, load_skills: [] },
        toolCtx,
        executorCtx,
        parentContext,
        'task',
        undefined,
        undefined,
        'bench-model',
      )
      if (typeof result === 'string' && result.includes('SUPERVISED TASK COMPLETED')) {
        unstableFetches = String(calls)
      } else {
        unstablePath = 'not-driven reason=' + JSON.stringify(String(result).slice(0, 80))
      }
    } finally {
      __setTimingConfig({
        POLL_INTERVAL_MS: 1000,
        MIN_STABILITY_TIME_MS: 10000,
        STABILITY_POLLS_REQUIRED: 3,
        MAX_POLL_TIME_MS: 600000,
      })
    }
  } catch (error) {
    unstablePath = 'not-driven reason=' + JSON.stringify(String(error).slice(0, 80))
  }

  void mode
  const lines = [
    'opt=3',
    'mode=' + mode,
    'opt3_path=pollSyncSession-real,' + unstablePath,
    'poller_fetch_calls=' + median(pollerFetches),
    'fetch_calls_per_call=' + median(pollerFetches),
    'unstable_fetch_calls_per_call=' + unstableFetches,
    'transport=session.context-counted-no-network',
  ]
  return { lines, file: writeEvidence(3, mode, lines) }
}

// ---------------------------------------------------------------- Opt-5

class CountingStore extends ManagerStore {
  parentLookupCalls = 0
  override getTasksByParentSession(sessionID: string) {
    this.parentLookupCalls++
    return super.getTasksByParentSession(sessionID)
  }
}

async function benchOpt5(mode: string): Promise<{ lines: string[]; file: string }> {
  const CHILDREN = 50
  const GRANDCHILDREN = 10
  const store = new CountingStore(join(tmpdir(), "mx-opt5-dir"))
  const rootSession = "ses_root"
  store.tasks.set("bg_root", {
    id: "bg_root",
    parentSessionID: "ses_grandparent",
    parentMessageID: "msg_1",
    description: "root",
    prompt: "bench",
    agent: "task",
    status: "running",
    sessionID: rootSession,
  })
  for (let c = 0; c < CHILDREN; c++) {
    const childSession = `ses_child_${c}`
    store.tasks.set(`bg_child_${c}`, {
      id: `bg_child_${c}`,
      parentSessionID: rootSession,
      parentMessageID: "msg_1",
      description: `child ${c}`,
      prompt: "bench",
      agent: "task",
      status: "running",
      sessionID: childSession,
    })
    for (let g = 0; g < GRANDCHILDREN; g++) {
      store.tasks.set(`bg_gc_${c}_${g}`, {
        id: `bg_gc_${c}_${g}`,
        parentSessionID: childSession,
        parentMessageID: "msg_1",
        description: `grandchild ${c}/${g}`,
        prompt: "bench",
        agent: "task",
        status: "running",
        sessionID: `ses_gc_${c}_${g}`,
      })
    }
  }
  const taskCount = store.tasks.size
  void mode

  const RUNS = 5
  const times: number[] = []
  const lookups: number[] = []
  let descendantCount = 0
  for (let run = 0; run < RUNS; run++) {
    store.parentLookupCalls = 0
    const t0 = process.hrtime.bigint()
    const descendants = store.getAllDescendantTasks(rootSession)
    times.push(msSince(t0))
    lookups.push(store.parentLookupCalls)
    descendantCount = descendants.length
  }

  const lines = [
    `opt=5`,
    `mode=${mode}`,
    `tasks=${taskCount}`,
    `descendants=${descendantCount}`,
    `descendant_median_ms=${median(times).toFixed(3)}`,
    `descendant_min_ms=${min(times).toFixed(3)}`,
    `descendant_max_ms=${max(times).toFixed(3)}`,
    `parent_lookup_calls=${median(lookups)}`,
  ]
  return { lines, file: writeEvidence(5, mode, lines) }
}

// ---------------------------------------------------------------- Opt-6

const OPT6_FILES = [
  "src/tools/delegate-task/sync-session-poller.ts",
  "src/tools/delegate-task/unstable-agent-task.ts",
  "src/tools/delegate-task/timing.ts",
  "src/features/background-agent/state.ts",
  "src/features/background-agent/manager/store.ts",
  "src/features/background-agent/handle-index.ts",
  "src/features/background-agent/manager/lifecycle.ts",
  "src/shared/session/session-context-source.ts",
]

async function benchOpt6(mode: string): Promise<{ lines: string[]; file: string }> {
  // No timing claim. Static scan for duplicated timeout literals:
  // setTimeout(<number> occurrences plus TIMEOUT/INTERVAL/STABILITY-ish
  // symbolic literals. duplicated = total occurrences beyond first use per
  // distinct literal.
  const literalCounts = new Map<string, number>()
  const perFile: string[] = []
  for (const rel of OPT6_FILES) {
    let text = ""
    try {
      text = readFileSync(join(process.cwd(), rel), "utf-8")
    } catch {
      perFile.push(`${rel}:unreadable`)
      continue
    }
    let fileHits = 0
    const numeric = text.match(/setTimeout\(\s*\d+/g) ?? []
    for (const m of numeric) {
      literalCounts.set(m, (literalCounts.get(m) ?? 0) + 1)
      fileHits++
    }
    const symbolic = text.match(/\b[A-Z][A-Z0-9_]*(?:TIMEOUT|INTERVAL|STABILITY|POLL)[A-Z0-9_]*\b/g) ?? []
    for (const m of symbolic) {
      literalCounts.set(m, (literalCounts.get(m) ?? 0) + 1)
      fileHits++
    }
    perFile.push(`${rel}:${fileHits}`)
  }
  let total = 0
  for (const n of literalCounts.values()) total += n
  const duplicated = total - literalCounts.size

  const lines = [
    `opt=6`,
    `mode=${mode}`,
    `opt6_path=static-scan-no-timing`,
    `files_scanned=${OPT6_FILES.length}`,
    `timeout_literal_total=${total}`,
    `timeout_literal_distinct=${literalCounts.size}`,
    `duplicate_literal_occurrences=${duplicated}`,
    `per_file=${perFile.join(",")}`,
  ]
  return { lines, file: writeEvidence(6, mode, lines) }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === null) {
    process.stderr.write(usage() + "\n")
    process.exit(2)
  }
  const { opt, mode } = parsed

  if (opt === 4) {
    // Removal-only opt: no timing metric exists. No evidence file is written.
    process.stdout.write(
      [
        "opt=4",
        `mode=${mode}`,
        "removal-exempt: no perf bench (Opt-4 is dead-code removal of completionTimers; nothing to time)",
      ].join("\n") + "\n",
    )
    process.exit(0)
  }

  let result: { lines: string[]; file: string }
  if (opt === 1) result = await benchOpt1(mode)
  else if (opt === 2) result = await benchOpt2(mode)
  else if (opt === 3) result = await benchOpt3(mode)
  else if (opt === 5) result = await benchOpt5(mode)
  else result = await benchOpt6(mode)

  process.stdout.write(result.lines.join("\n") + "\n")
  process.stderr.write(`wrote ${result.file}\n`)
  // Safety: never leave the fs mock active past process exit (single-opt
  // process, but keep the invariant explicit for future multi-opt reuse).
  try {
    const { mock } = await import("bun:test")
    mock.restore()
  } catch {
    // mock.restore unavailable outside test runner — process exit clears it.
  }
}

await main()
