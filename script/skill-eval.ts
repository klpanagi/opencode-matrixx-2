/// <reference types="bun-types" />
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_SKILL_VERSION, collectBuiltinSkills, synthesizeSkillMd, type ExportedSkill } from "./skill-eval/catalog"
import {
  CATALOG_DIRNAME,
  CATALOG_SUMMARY_FILE,
  EVALUATOR_NAME,
  EXIT_FAILURE,
  EXIT_INCOMPLETE,
  EXIT_OK,
  EXIT_USAGE,
  PASS_THRESHOLD,
  QUALITY_DIRNAME,
  QUALITY_REPORT_FILE,
  REPORT_PREFIX,
  REPORTS_DIRNAME,
  SKILLS_DIRNAME,
} from "./skill-eval/constants"
import { asRecord } from "./skill-eval/json"
import {
  type CatalogSummary,
  type QualityRow,
  formatSummaryTable,
  isScored,
  parseCatalogSummary,
  parseQualityReport,
  summarize,
  topDeductionMessages,
  unscoredRow,
} from "./skill-eval/report"

export { DEFAULT_AUTHOR, DEFAULT_SKILL_VERSION, collectBuiltinSkills, resolveDirNames, synthesizeSkillMd } from "./skill-eval/catalog"
export type { ExportedSkill, SkillCandidate, SkillMdOptions } from "./skill-eval/catalog"
export { EXPECTED_SKILL_COUNT, PASS_THRESHOLD } from "./skill-eval/constants"
export {
  formatSummaryTable,
  isScored,
  parseCatalogSummary,
  parseQualityReport,
  summarize,
  topDeductionMessages,
  unscoredRow,
} from "./skill-eval/report"
export type { CatalogSkillResult, CatalogSummary, QualityRow } from "./skill-eval/report"

export interface ValidateArgsOptions {
  catalogDir: string
  reportsDir: string
  tiers: string
  deep: boolean
  evaluatorOnPath: boolean
  workers?: number
}

export interface CliOptions {
  command: "export" | "eval"
  outDir: string
  only: string[]
  limit?: number
  deep: boolean
  tiers: string
  workers?: number
  skipQualityTable: boolean
  concurrency: number
  allowFail: boolean
  json: boolean
  verbose: boolean
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(SCRIPT_DIR)
const DEFAULT_OUT_DIR = ".matrixx/skill-eval"
export const DEFAULT_CHECKS = "schema,version,quality,lint,pii,license,unicode"
export const DEEP_CHECKS = "schema,version,security,pii,license,code-integrity,unicode,quality,lint"
const TIER_PATTERN = /^[123](,[123])*$/
const USAGE = `Usage: bun script/skill-eval.ts [export|eval] [flags]

  export                 write <out>/catalog/skills/<dir>/SKILL.md for every builtin skill (default: eval)
  --out <dir>            output directory (default: ${DEFAULT_OUT_DIR}); a leading ~ is expanded
  --only <name,name>     restrict to directory names first, then skill names
  --limit <n>            cap the catalog size (also disables the quality table)
  --deep                 run scanner-backed checks (security, code-integrity); may report inconclusive (exit 3)
  --tiers <list>         evaluator tiers; tier 1 is mandatory, e.g. 1 or 1,2,3 (default: 1)
  --workers <n>          pass --workers n to the evaluator's catalog run
  --skip-quality-table   skip the per-skill quality-check pass
  --concurrency <n>      parallel quality-check runs (default: 4)
  --verbose              list every inconclusive skill instead of the first 5
  --allow-fail           always exit 0
  --json                 print the eval summary as JSON on stdout (progress goes to stderr)`

type Logger = (message: string) => void

function createLogger(json: boolean): Logger {
  return json ? (message) => console.error(message) : (message) => console.log(message)
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`${flag} expects a positive integer, got '${value}'`)
  return parsed
}

export function parseTiers(value: string): string {
  if (!TIER_PATTERN.test(value)) {
    throw new UsageError(`--tiers accepts a comma-separated subset of 1,2,3, got '${value}'`)
  }
  const tiers = [...new Set(value.split(","))].sort((left, right) => Number(left) - Number(right))
  if (!tiers.includes("1")) {
    throw new UsageError("--tiers must include tier 1: the evaluator always runs Tier 1 and rejects other selections")
  }
  return tiers.join(",")
}

export function expandHomePath(value: string, home: string | undefined): string {
  if (value !== "~" && !value.startsWith("~/")) return value
  if (home === undefined || home.trim().length === 0) {
    throw new UsageError(`cannot expand '~' because HOME is not set (got '${value}')`)
  }
  return value === "~" ? home : join(home, value.slice(2))
}

export function parseArgs(argv: string[], home: string | null = process.env.HOME ?? null): CliOptions {
  const options: CliOptions = {
    command: "eval",
    outDir: DEFAULT_OUT_DIR,
    only: [],
    deep: false,
    tiers: "1",
    skipQualityTable: false,
    concurrency: 4,
    allowFail: false,
    json: false,
    verbose: false,
  }
  let index = 0
  const first = argv[0]
  if (first === "export" || first === "eval") {
    options.command = first
    index = 1
  } else if (first !== undefined && !first.startsWith("-")) {
    throw new UsageError(`unknown command '${first}' (expected export or eval)`)
  }
  while (index < argv.length) {
    const flag = argv[index] ?? ""
    index += 1
    const nextValue = (): string => {
      const value = argv[index]
      if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`)
      index += 1
      return value
    }
    switch (flag) {
      case "--out":
        options.outDir = expandHomePath(nextValue(), home ?? undefined)
        break
      case "--only":
        options.only = nextValue()
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
        break
      case "--limit":
        options.limit = parsePositiveInt(nextValue(), "--limit")
        break
      case "--tiers":
        options.tiers = parseTiers(nextValue())
        break
      case "--workers":
        options.workers = parsePositiveInt(nextValue(), "--workers")
        break
      case "--concurrency":
        options.concurrency = parsePositiveInt(nextValue(), "--concurrency")
        break
      case "--deep":
        options.deep = true
        break
      case "--skip-quality-table":
        options.skipQualityTable = true
        break
      case "--verbose":
        options.verbose = true
        break
      case "--allow-fail":
        options.allowFail = true
        break
      case "--json":
        options.json = true
        break
      default:
        throw new UsageError(`unknown flag '${flag}'`)
    }
  }
  return options
}

function runnerPrefix(evaluatorOnPath: boolean): string[] {
  return evaluatorOnPath ? [EVALUATOR_NAME] : ["uvx", "--python", "3.13", EVALUATOR_NAME]
}

export function buildValidateArgs(options: ValidateArgsOptions): string[] {
  const args = [
    ...runnerPrefix(options.evaluatorOnPath),
    "validate",
    options.catalogDir,
    "--tiers",
    options.tiers,
    "-r",
    "json",
    "-r",
    "markdown",
    "-o",
    options.reportsDir,
    "--checks",
    options.deep ? DEEP_CHECKS : DEFAULT_CHECKS,
  ]
  if (options.workers !== undefined) args.push("--workers", `${options.workers}`)
  return args
}

interface ExportResult {
  exported: ExportedSkill[]
  renamed: ExportedSkill[]
  version: string
}

interface ReportPaths {
  catalogSummary: string | null
  json: string | null
  markdown: string | null
}

async function readPackageVersion(rootDir: string): Promise<string> {
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf8")
    const parsed = asRecord(JSON.parse(raw))
    return parsed && typeof parsed.version === "string" ? parsed.version : DEFAULT_SKILL_VERSION
  } catch {
    return DEFAULT_SKILL_VERSION
  }
}

async function exportCatalog(skills: ExportedSkill[], catalogDir: string, rootDir: string): Promise<ExportResult> {
  const version = await readPackageVersion(rootDir)
  const skillsDir = join(catalogDir, SKILLS_DIRNAME)
  for (const skill of skills) {
    const dir = join(skillsDir, skill.dirName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "SKILL.md"), synthesizeSkillMd(skill, { version }), "utf8")
  }
  return { exported: skills, renamed: skills.filter((skill) => skill.dirName !== skill.name), version }
}

export function selectSkills(skills: ExportedSkill[], options: CliOptions): ExportedSkill[] {
  let selected = skills
  if (options.only.length > 0) {
    const unmatched = options.only.filter(
      (query) => !skills.some((skill) => skill.dirName === query || skill.name === query),
    )
    if (unmatched.length > 0) throw new UsageError(`no skills matched --only: ${unmatched.join(", ")}`)
    const chosen = new Set<string>()
    for (const query of options.only) {
      const dirMatches = skills.filter((skill) => skill.dirName === query)
      const matches = dirMatches.length > 0 ? dirMatches : skills.filter((skill) => skill.name === query)
      for (const skill of matches) chosen.add(skill.dirName)
    }
    selected = skills.filter((skill) => chosen.has(skill.dirName))
  }
  selected = [...selected].sort((left, right) => left.dirName.localeCompare(right.dirName))
  return options.limit === undefined ? selected : selected.slice(0, options.limit)
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item)
    }
  })
  await Promise.all(workers)
  return results
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runQualityChecks(
  skills: ExportedSkill[],
  catalogDir: string,
  reportsDir: string,
  runner: string[],
  concurrency: number,
): Promise<QualityRow[]> {
  const qualityRoot = join(reportsDir, QUALITY_DIRNAME)
  await mkdir(qualityRoot, { recursive: true })
  return mapWithConcurrency(skills, concurrency, async (skill) => {
    const skillDir = join(catalogDir, SKILLS_DIRNAME, skill.dirName)
    const reportDir = join(qualityRoot, skill.dirName)
    await mkdir(reportDir, { recursive: true })
    const args = [...runner, "quality-check", skillDir, "-r", "json", "-o", reportDir]
    let exitCode: number
    let stderr = ""
    try {
      const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
      const stdoutText = new Response(process.stdout).text()
      const stderrText = new Response(process.stderr).text()
      exitCode = await process.exited
      const [, capturedStderr] = await Promise.all([stdoutText, stderrText])
      stderr = capturedStderr
    } catch (error) {
      return unscoredRow(skill.dirName, `quality-check failed to start: ${describeError(error)}`)
    }
    const reportPath = join(reportDir, QUALITY_REPORT_FILE)
    let text: string
    try {
      text = await readFile(reportPath, "utf8")
    } catch {
      const detail = stderr.trim().slice(0, 200)
      return unscoredRow(
        skill.dirName,
        `quality-check exited ${exitCode} without writing a report${detail.length > 0 ? `: ${detail}` : ""}`,
      )
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch (error) {
      return unscoredRow(skill.dirName, `invalid quality report JSON: ${describeError(error)}`)
    }
    return parseQualityReport(payload, skill.dirName)
  })
}

async function collectReportFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectReportFiles(fullPath)))
      continue
    }
    files.push(fullPath)
  }
  return files
}

async function listPerSkillReports(reportsDir: string, extension: ".json" | ".md"): Promise<string[]> {
  const files = await collectReportFiles(reportsDir)
  return files
    .filter((file) => basename(file).startsWith(REPORT_PREFIX) && file.endsWith(extension))
    .sort((left, right) => basename(left).localeCompare(basename(right)))
}

async function newestReport(reportsDir: string, extension: ".json" | ".md"): Promise<string | null> {
  const matches = await listPerSkillReports(reportsDir, extension)
  const newest = matches.at(-1)
  return newest === undefined ? null : newest
}

type CatalogReport =
  | { kind: "ok"; summary: CatalogSummary; path: string }
  | { kind: "missing" }
  | { kind: "malformed"; path: string; error: string }

async function readCatalogReport(reportsDir: string): Promise<CatalogReport> {
  const path = join(reportsDir, CATALOG_SUMMARY_FILE)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return { kind: "missing" }
  }
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch (error) {
    return { kind: "malformed", path, error: describeError(error) }
  }
  const summary = parseCatalogSummary(payload)
  return summary === null
    ? { kind: "malformed", path, error: "unrecognized catalog summary shape" }
    : { kind: "ok", summary, path }
}

function collectIncompleteScans(summary: CatalogSummary | null): string[] {
  if (!summary) return []
  return [...new Set(summary.skills.flatMap((skill) => skill.incompleteScans))]
}

function buildSummary(
  catalog: ExportResult,
  rows: QualityRow[],
  validateExitCode: number,
  catalogReport: CatalogSummary | null,
  reports: ReportPaths,
  inconclusive: boolean,
) {
  const summary = summarize(rows)
  return {
    exported: catalog.exported.length,
    version: catalog.version,
    renamed: catalog.renamed.map((skill) => ({ name: skill.name, dirName: skill.dirName })),
    validateExitCode,
    inconclusive,
    incompleteScans: collectIncompleteScans(catalogReport),
    catalog: catalogReport,
    quality: {
      evaluated: summary.scored,
      passing: summary.passing,
      belowThreshold: summary.belowThreshold,
      mean: summary.mean,
      topDeductions: topDeductionMessages(rows, 5),
    },
    rows,
    reports,
  }
}

async function runEvaluation(options: CliOptions, catalog: ExportResult, outDir: string): Promise<number> {
  const log = createLogger(options.json)
  const catalogDir = join(outDir, CATALOG_DIRNAME)
  const reportsDir = join(outDir, REPORTS_DIRNAME)
  await mkdir(reportsDir, { recursive: true })
  const evaluatorOnPath = Bun.which(EVALUATOR_NAME) !== null
  if (!evaluatorOnPath && Bun.which("uv") === null) {
    console.error(
      `${EVALUATOR_NAME} is unavailable: install uv (https://docs.astral.sh/uv/) or \`pipx install ${EVALUATOR_NAME}\`. This script runs \`uvx --python 3.13 ${EVALUATOR_NAME}\` when ${EVALUATOR_NAME} is not on PATH.`,
    )
    return EXIT_USAGE
  }
  const validateArgs = buildValidateArgs({
    catalogDir,
    reportsDir,
    tiers: options.tiers,
    deep: options.deep,
    evaluatorOnPath,
    workers: options.workers,
  })
  log(`running: ${validateArgs.join(" ")}`)
  const validateProcess = options.json
    ? Bun.spawn(validateArgs, { stdout: 2, stderr: 2 })
    : Bun.spawn(validateArgs, { stdout: "inherit", stderr: "inherit" })
  const validateExitCode = await validateProcess.exited
  const runQualityTable = !options.skipQualityTable && options.limit === undefined
  const rows = runQualityTable
    ? await runQualityChecks(catalog.exported, catalogDir, reportsDir, runnerPrefix(evaluatorOnPath), options.concurrency)
    : []
  const scoredRows = rows.filter(isScored)
  const unscoredRows = rows.filter((row) => row.score === null)
  const catalogReport = await readCatalogReport(reportsDir)
  if (catalogReport.kind === "malformed") {
    console.error(`catalog summary is unreadable (${catalogReport.path}): ${catalogReport.error}`)
  }
  const catalogSummary = catalogReport.kind === "ok" ? catalogReport.summary : null
  const failedSkills = catalogSummary ? catalogSummary.skills.filter((skill) => !skill.passed) : []
  const realFailures = failedSkills.filter((skill) => skill.incompleteScans.length === 0)
  const inconclusive =
    validateExitCode !== EXIT_OK && failedSkills.length > 0 && realFailures.length === 0 && unscoredRows.length === 0
  const markdownReports = await listPerSkillReports(reportsDir, ".md")
  const paths: ReportPaths = {
    catalogSummary: catalogReport.kind === "missing" ? null : catalogReport.path,
    json: await newestReport(reportsDir, ".json"),
    markdown: markdownReports.at(-1) ?? null,
  }
  if (options.json) {
    console.log(JSON.stringify(buildSummary(catalog, rows, validateExitCode, catalogSummary, paths, inconclusive), null, 2))
  } else {
    if (catalogSummary) {
      log(`catalog: ${catalogSummary.passed}/${catalogSummary.total} passed, ${catalogSummary.failed} failed`)
      const totals = Object.entries(catalogSummary.severityTotals)
        .map(([severity, count]) => `${severity}=${count}`)
        .join(" ")
      if (totals.length > 0) log(`severity totals: ${totals}`)
    }
    if (inconclusive && catalogSummary) {
      const scanners = collectIncompleteScans(catalogSummary).join(", ")
      const critical = catalogSummary.severityTotals.critical ?? 0
      const high = catalogSummary.severityTotals.high ?? 0
      log(
        `INCOMPLETE (exit 3): ${failedSkills.length}/${catalogSummary.total} skills could not be fully scanned — incomplete_scans: ${scanners}  (critical=${critical} high=${high})`,
      )
      log("  Cause: SkillSpector keeps a 'partial' analysis status when the skill body references example paths")
      log("  (src/..., README.md) that are not bundled next to SKILL.md. This is inconclusive, not a content failure.")
      const names = failedSkills.map((skill) => skill.name)
      if (options.verbose) {
        log(`  Skills: ${names.join(", ")}`)
      } else {
        const shown = names.slice(0, 5).join(", ")
        log(`  Skills: ${shown}${names.length > 5 ? ` +${names.length - 5} more` : ""}`)
      }
    }
    if (runQualityTable) {
      log(formatSummaryTable(rows))
      if (unscoredRows.length > 0) {
        log("Unscored skills:")
        for (const row of unscoredRows) log(`- ${row.skillName} — ${row.reason ?? "unknown reason"}`)
        if (scoredRows.length === 0) log("No skill was scored: every quality-check run failed or produced no report.")
      }
      const top = topDeductionMessages(rows, 5)
      if (top.length > 0) {
        log("\nTop deductions:")
        for (const entry of top) log(`- (${entry.count}x) ${entry.message}`)
      }
    } else {
      log("quality table skipped (--skip-quality-table or --limit)")
    }
    log(`\nCatalog summary: ${paths.catalogSummary ?? "not found"}`)
    log(`Newest JSON report: ${paths.json ?? "not found"}`)
    log(`Per-skill markdown reports: ${markdownReports.length} under ${join(reportsDir, SKILLS_DIRNAME)}`)
    log(`Per-skill markdown (newest): ${paths.markdown ?? "not found"}`)
  }
  if (options.allowFail) return EXIT_OK
  if (inconclusive) return EXIT_INCOMPLETE
  if (validateExitCode !== EXIT_OK || realFailures.length > 0) return EXIT_FAILURE
  if (runQualityTable && unscoredRows.length > 0) return EXIT_FAILURE
  if (scoredRows.some((row) => row.score < PASS_THRESHOLD)) return EXIT_FAILURE
  return EXIT_OK
}

export async function main(argv: string[]): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`skill-eval: ${error.message}`)
      console.error(USAGE)
      return EXIT_USAGE
    }
    throw error
  }
  const log = createLogger(options.json)
  const outDir = isAbsolute(options.outDir) ? options.outDir : join(process.cwd(), options.outDir)
  const catalogDir = join(outDir, CATALOG_DIRNAME)
  const reportsDir = join(outDir, REPORTS_DIRNAME)
  const allSkills = await collectBuiltinSkills(REPO_ROOT)
  let selected: ExportedSkill[]
  try {
    selected = selectSkills(allSkills, options)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`skill-eval: ${error.message}`)
      console.error(USAGE)
      return EXIT_USAGE
    }
    throw error
  }
  log(`removing ${catalogDir}`)
  await rm(catalogDir, { recursive: true, force: true })
  if (options.command === "eval") {
    log(`removing ${reportsDir}`)
    await rm(reportsDir, { recursive: true, force: true })
  }
  const catalog = await exportCatalog(selected, catalogDir, REPO_ROOT)
  const renamedNote =
    catalog.renamed.length > 0 ? `: ${catalog.renamed.map((skill) => `${skill.name} -> ${skill.dirName}`).join(", ")}` : ""
  log(`exported ${catalog.exported.length} skills (${catalog.renamed.length} dirs renamed${renamedNote})`)
  if (options.command === "export") return EXIT_OK
  return runEvaluation(options, catalog, outDir)
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)))
}
