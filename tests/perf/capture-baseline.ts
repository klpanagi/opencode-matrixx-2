/**
 * Capture the pre-optimization baseline for
 * `.matrixx/plans/performance-optimizations.md` (task T1).
 *
 * Run from anywhere:
 *
 * ```sh
 * bun run tests/perf/capture-baseline.ts
 * ```
 *
 * Writes `tests/perf/BASELINE.md` with:
 *   1. the plan's §3 baseline table re-derived from this worktree,
 *   2. the 9 per-optimization rows that T2..T13 fill with before/after
 *      numbers (all `pending` on a fresh checkout).
 *
 * Deterministic: no timestamps, stable ordering, and counts come from fixed
 * regexes. Running it twice on the same tree produces identical numbers.
 *
 * Dist sizes require a build first (`dist/` is gitignored):
 *   bun run build:plugin && bun run build:tools && bun run build:cli
 * Missing dist is reported as `not built`, never as an error.
 *
 * Once a later task records a number, the script refuses to overwrite the
 * file (that would erase evidence). Pass `--force` to regenerate anyway.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { repoRoot } from "../helpers/repo-root"

const ROOT = repoRoot()
const OUTPUT = join(ROOT, "tests/perf/BASELINE.md")

/** Plan §3 ("Baseline Facts", captured before any change). */
const PLAN_FACTS = {
  distIndexMb: 3.28,
  distToolsMb: 0.39,
  distCliMb: 0.42,
  ciTestCount: 5356,
  ciDurationSeconds: 11.8,
  syncFsCallSites: 687,
  logCallSites: 594,
  moduleMutableBindings: 121,
  newRegExpSites: 36,
} as const

/**
 * Synchronous `node:fs` entry points. Occurrence-based (`rg -o ... | wc -l`),
 * so a line with two calls counts twice.
 */
const SYNC_FS_PATTERN =
  "\\b(?:readFileSync|writeFileSync|appendFileSync|readdirSync|mkdirSync|mkdtempSync" +
  "|rmSync|rmdirSync|unlinkSync|renameSync|copyFileSync|cpSync|realpathSync|lstatSync" +
  "|statSync|fstatSync|existsSync|accessSync|chmodSync|chownSync|symlinkSync|truncateSync" +
  "|utimesSync|openSync|closeSync|readSync|writeSync|fsyncSync|opendirSync)\\("

/** Plugin logger calls, excluding `console.log(` and `<obj>.log(`. */
const LOG_CALL_PATTERN = "(?<![\\w.])log\\("

/** Module-scope `let`/`var` declarations (one match per declaration line). */
const MODULE_MUTABLE_PATTERN = "^(?:export\\s+)?(?:let|var)\\s"

const NEW_REGEXP_PATTERN = "new RegExp"

const SRC_GLOB = "src/**/*.ts"

interface CountResult {
  readonly value: number
  readonly command: string
}

function spawnRg(args: string[]) {
  return Bun.spawnSync({ cmd: args, cwd: ROOT, stdout: "pipe", stderr: "pipe" })
}

function countInSrc(pattern: string): CountResult {
  const args = ["rg", "-o", "--no-filename", "--pcre2", "-g", SRC_GLOB, "-e", pattern, "src"]
  let proc: ReturnType<typeof spawnRg>
  try {
    proc = spawnRg(args)
  } catch (error) {
    throw new Error(
      `capture-baseline: ripgrep is required to derive the §3 counts (${String(error)}). ` +
        `Install it or run the commands listed in BASELINE.md by hand.`,
    )
  }
  // 0 = matches, 1 = no matches (a legitimate zero), 2+ = real failure.
  if (proc.exitCode !== 0 && proc.exitCode !== 1) {
    throw new Error(
      `capture-baseline: rg failed (exit ${proc.exitCode}): ${proc.stderr.toString().trim()}`,
    )
  }
  const stdout = proc.stdout.toString()
  const matches = stdout.length === 0 ? 0 : stdout.split("\n").filter((line) => line.length > 0).length
  return { value: matches, command: `rg -o -g '${SRC_GLOB}' -e '${pattern}' src | wc -l` }
}

function countTestFiles(): number {
  let total = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) total++
    }
  }
  for (const dir of ["tests", "script"]) {
    const path = join(ROOT, dir)
    if (existsSync(path)) walk(path)
  }
  return total
}

function distSizeMb(relativePath: string): number | null {
  const path = join(ROOT, relativePath)
  if (!existsSync(path)) return null
  return statSync(path).size / (1024 * 1024)
}

function formatMb(mb: number | null): string {
  return mb === null ? "not built" : `${mb.toFixed(2)} MB`
}

function mdCell(text: string): string {
  return text.replaceAll("|", "\\|")
}

function ciTestCount(ciLogPath: string | null): { value: number; source: string } {
  if (ciLogPath === null) {
    return {
      value: PLAN_FACTS.ciTestCount,
      source: "plan §3 (documented; pass `--ci-log <file>` to parse a real run)",
    }
  }
  const log = readFileSync(ciLogPath, "utf8")
  const matches = [...log.matchAll(/(\d+)\s+pass\b/g)]
  const last = matches.at(-1)
  if (last === undefined) {
    throw new Error(`capture-baseline: no "<n> pass" line found in ${ciLogPath}`)
  }
  return { value: Number(last[1]), source: `parsed from ${ciLogPath}` }
}

interface TableRow {
  readonly metric: string
  readonly plan: string
  readonly measured: string
  readonly status: string
  readonly provenance: string
}

function statusFor(planNumber: number, measured: number | null): string {
  if (measured === null) return "n/a"
  return Math.abs(planNumber - measured) < 1e-9 ? "match" : "DRIFT"
}

function statusForMb(planMb: number, measuredMb: number | null): string {
  if (measuredMb === null) return "n/a"
  return Math.abs(planMb - Number(measuredMb.toFixed(2))) < 1e-9 ? "match" : "DRIFT"
}

interface BaselineInputs {
  readonly ciLogPath: string | null
}

function buildBaseline(inputs: BaselineInputs): { markdown: string; rows: readonly TableRow[] } {
  const syncFs = countInSrc(SYNC_FS_PATTERN)
  const logCalls = countInSrc(LOG_CALL_PATTERN)
  const moduleMutable = countInSrc(MODULE_MUTABLE_PATTERN)
  const newRegExp = countInSrc(NEW_REGEXP_PATTERN)
  const testFiles = countTestFiles()
  const ci = ciTestCount(inputs.ciLogPath)

  const indexMb = distSizeMb("dist/index.js")
  const toolsMb = distSizeMb("dist/tools.js")
  const cliMb = distSizeMb("dist/cli.js")

  const rows: TableRow[] = [
    {
      metric: "`dist/index.js`",
      plan: `${PLAN_FACTS.distIndexMb.toFixed(2)} MB`,
      measured: formatMb(indexMb),
      status: statusForMb(PLAN_FACTS.distIndexMb, indexMb),
      provenance: "`statSync('dist/index.js').size / 1024²` after `bun run build:plugin`",
    },
    {
      metric: "`dist/tools.js`",
      plan: `${PLAN_FACTS.distToolsMb.toFixed(2)} MB`,
      measured: formatMb(toolsMb),
      status: statusForMb(PLAN_FACTS.distToolsMb, toolsMb),
      provenance: "`statSync('dist/tools.js').size / 1024²` after `bun run build:tools`",
    },
    {
      metric: "`dist/cli.js`",
      plan: `${PLAN_FACTS.distCliMb.toFixed(2)} MB`,
      measured: formatMb(cliMb),
      status: statusForMb(PLAN_FACTS.distCliMb, cliMb),
      provenance: "`statSync('dist/cli.js').size / 1024²` after `bun run build:cli`",
    },
    {
      metric: "Full CI test count",
      plan: String(PLAN_FACTS.ciTestCount),
      measured: String(ci.value),
      status: statusFor(PLAN_FACTS.ciTestCount, ci.value),
      provenance: mdCell(ci.source),
    },
    {
      metric: "Synchronous fs call sites in `src/`",
      plan: String(PLAN_FACTS.syncFsCallSites),
      measured: String(syncFs.value),
      status: statusFor(PLAN_FACTS.syncFsCallSites, syncFs.value),
      provenance: `\`${mdCell(syncFs.command)}\``,
    },
    {
      metric: "`log(` call sites",
      plan: String(PLAN_FACTS.logCallSites),
      measured: String(logCalls.value),
      status: statusFor(PLAN_FACTS.logCallSites, logCalls.value),
      provenance: `\`${mdCell(logCalls.command)}\` (excludes \`console.log(\` / \`x.log(\`)`,
    },
    {
      metric: "Module-level mutable bindings",
      plan: String(PLAN_FACTS.moduleMutableBindings),
      measured: String(moduleMutable.value),
      status: statusFor(PLAN_FACTS.moduleMutableBindings, moduleMutable.value),
      provenance: `\`${mdCell(moduleMutable.command)}\` (module-scope \`let\`/\`var\`)`,
    },
    {
      metric: "`new RegExp` sites",
      plan: String(PLAN_FACTS.newRegExpSites),
      measured: String(newRegExp.value),
      status: statusFor(PLAN_FACTS.newRegExpSites, newRegExp.value),
      provenance: `\`${mdCell(newRegExp.command)}\``,
    },
  ]

  const drift = rows.filter((row) => row.status === "DRIFT")
  const driftNote =
    drift.length === 0
      ? "All §3 metrics reproduce exactly on this worktree."
      : `${drift.length} of ${rows.length} §3 metrics differ from the plan value on this worktree ` +
        `(${drift.map((row) => row.metric).join(", ")}). The plan recorded authoring-time numbers ` +
        `("provided as verified baseline facts", per its §3 note); this script re-derives them so the ` +
        `report has provenance. Where a definition differs, the Provenance column is the source of ` +
        `truth, and the measured column is authoritative for every before/after comparison here.`

  const lines: string[] = [
    "# Performance Baseline — measurement provenance (T1)",
    "",
    "Generated by `bun run tests/perf/capture-baseline.ts` from",
    "`.matrixx/plans/performance-optimizations.md` (task T1, measurement-only).",
    "",
    `- Bun \`${Bun.version}\` · source tree at \`src/**/*.ts\``,
    "- Ship gate for every optimization: ≥10% median improvement on the targeted metric **and** no p95 regression (plan Ruling F).",
    "- The `before` column below is captured on the **unmodified** tree; T2..T13 record `after` + delta here.",
    "",
    "## §3 Baseline Table (re-derived)",
    "",
    "| Metric | Plan §3 | Measured | Status | Provenance |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.metric} | ${row.plan} | ${row.measured} | ${row.status} | ${row.provenance} |`,
    ),
    "",
    `**Drift note**: ${driftNote}`,
    "",
    "Supporting, host-independent metric (a stable proxy for the CI test count above;",
    "CI discovers tests with `find tests script -name '*.test.ts'`):",
    "",
    `- Discovered test files: **${testFiles}**`,
    "",
    "## Per-Optimization Baseline Rows (filled by later tasks)",
    "",
    "Replace `pending` with the measured value, then record `after`, `delta` and a",
    "`SHIPPED` / `REJECTED` / `NO-OP` verdict. A rejected row keeps its number — it is",
    "evidence, not a failure to hide. Re-running this script with recorded rows present",
    "refuses to overwrite the file unless `--force` is passed.",
    "",
    "| id | task | unit recorded | evidence source | before | after | delta | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| P1 | T2 | `findRuleFiles` p50 (ms) + `statSync` count on cache hit | `tests/hooks/rules-injector/rule-discovery.bench.ts` | pending | pending | pending | pending |",
    "| P2 | T3/T4/T5 | dispatch p50 (ms) + awaits/event, per hot path (event, tool.execute.after, chat.message) | `tests/plugin/tool/event-dispatch.bench.ts`, `tests/plugin/tool/tool-execute-after.bench.ts`, `tests/plugin/tool/chat-message.bench.ts` | pending | pending | pending | pending |",
    "| P3a | T6 | `rtk-bash-rewriter` p50 (ms) + `Bun.spawn` count on passthrough | `tests/hooks/rtk-bash-rewriter/hook.bench.ts` | pending | pending | pending | pending |",
    "| P3b | T7 | `gitleaks-runner` p50 (ms) + scan count for an unchanged staged set | `tests/hooks/secret-leak-guard/gitleaks-runner.bench.ts` | pending | pending | pending | pending |",
    "| P5 | T8 | skills loader first-load p50 (ms) + `dist/index.js` size (MB) | `tests/skills/loader/factories.bench.ts` + `statSync` | pending | pending | pending | pending |",
    "| P6 | T9 | bytes written per message/part + `writeFileSync` count on the JSON write paths | T9 bench/bytes test (see plan T9) | pending | pending | pending | pending |",
    "| P7 | T10 | fs operations for 1000 `willBlockGrepGlob` calls (expected 1 walk) | `tests/shared/policy/context-mode-enforcement.bench.ts` | pending | pending | pending | pending |",
    "| P8 | T11 | `mkdtempSync` count across N scans + p50 (ms) | `tests/shared/comment-scan/ast-scan.bench.ts` | pending | pending | pending | pending |",
    "| P11 | T13 | fs reads per `hasConnectedProvidersCache()` call | `tests/shared/model/connected-providers-cache.bench.ts` | pending | pending | pending | pending |",
    "",
    "## Reproduce",
    "",
    "```sh",
    "# dist sizes need build output first (dist/ is gitignored)",
    "bun run build:plugin && bun run build:tools && bun run build:cli",
    "bun run tests/perf/capture-baseline.ts",
    "# optional: derive the test count from a real CI log (last '<n> pass' line wins)",
    "bun run tests/perf/capture-baseline.ts --ci-log /tmp/ci.log",
    "```",
    "",
    "## Host Variance",
    "",
    "- Counts and bundle sizes are deterministic on a given tree; only the CI test count depends on the run.",
    "- Wall-clock bench numbers are host-dependent (1-5 ms native vs 50-500 ms on NFS/WSL).",
    "  Record them anyway, but pair every filesystem bench with a call-count assertion",
    "  (`createFsCallCounter` / `assertNoFsCalls` in `tests/perf/bench-utils.ts`), which is",
    "  the host-independent ship gate.",
    "",
  ]

  return { markdown: `${lines.join("\n")}\n`, rows }
}

function parseArgs(argv: readonly string[]): { force: boolean; ciLogPath: string | null } {
  let force = false
  let ciLogPath: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--force") force = true
    else if (arg === "--ci-log") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("capture-baseline: --ci-log requires a path")
      ciLogPath = next
      i++
    } else {
      throw new Error(`capture-baseline: unknown argument ${arg}`)
    }
  }
  return { force, ciLogPath }
}

function hasRecordedMeasurements(content: string): boolean {
  return content
    .split("\n")
    .some((line) => /^\|\s*P\d/.test(line) && !line.includes("pending"))
}

function main(): void {
  const { force, ciLogPath } = parseArgs(process.argv.slice(2))
  const { markdown, rows } = buildBaseline({ ciLogPath })

  if (!force && existsSync(OUTPUT) && hasRecordedMeasurements(readFileSync(OUTPUT, "utf8"))) {
    console.log(
      "capture-baseline: BASELINE.md already contains recorded measurements; refusing to overwrite. " +
        "Pass --force to regenerate.",
    )
    return
  }

  writeFileSync(OUTPUT, markdown)
  const summary = rows
    .map((row) => `| ${row.metric} | ${row.plan} | ${row.measured} | ${row.status} |`)
    .join("\n")
  console.log(`capture-baseline: wrote ${OUTPUT}\n`)
  console.log(summary)
  console.log("\nplaceholder rows: P1, P2, P3a, P3b, P5, P6, P7, P8, P11")
}

main()
