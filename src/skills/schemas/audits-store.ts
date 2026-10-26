import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import {
  FindingSchema,
  LedgerSchema,
  type SecurityAuditFinding,
  type SecurityAuditLedger,
} from "./security-audit"

/**
 * Task 9 — Ledger + findings persistence under `<project>/.matrixx/audits/`.
 *
 * Single store module colocated with the T5 validator schemas (SoT in
 * `security-audit.ts`). All paths are project-scoped; no /tmp fallback, no
 * home-dir fallback. Outputs are gitignored (`.gitignore` `.matrixx/`) and
 * never committed. Writes are atomic via tmp+renameSync (mirrors
 * `handle-index.ts:103-122` and `task-storage/storage.ts:72-91`).
 */

export const AUDITS_DIR_NAME = "audits"
export const RUN_METADATA_FILE = "run-metadata.json"
export const COVERAGE_LEDGER_FILE = "coverage-ledger.json"
export const FINDINGS_FILE = "findings.json"

/** Run metadata: identifies one audit run and its budget gate outcome. */
export const RunMetadataSchema = z
  .object({
    run: z.string().min(1),
    startedAt: z.string().min(1),
    budget: z.number().int().min(0).optional(),
    funded: z.boolean(),
    status: z.enum(["complete", "incomplete"]),
  })
  .strict()
export type AuditRunMetadata = z.infer<typeof RunMetadataSchema>

export const FindingsSchema = z.array(FindingSchema)
export type AuditFindings = z.infer<typeof FindingsSchema>

/** Project-scoped audits root: `<project>/.matrixx/audits`. */
export function getAuditDir(projectRoot: string): string {
  return join(projectRoot, ".matrixx", AUDITS_DIR_NAME)
}

/** One run directory: `<project>/.matrixx/audits/<run-N>`. */
export function getRunDir(projectRoot: string, runN: string): string {
  return join(getAuditDir(projectRoot), runN)
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Atomically write one audit artifact: tmp file (pid suffix) + renameSync.
 * The target never exists in partial state; a mid-write crash leaves either
 * the old file or nothing, never a torn write. Throws on failure.
 */
export function writeAuditFile(runDir: string, filename: string, data: unknown): void {
  const filePath = join(runDir, filename)
  ensureDir(dirname(filePath))
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors — the original write error is the signal.
    }
    throw error
  }
}

function readValidated<T>(filePath: string, schema: z.ZodType<T>): T | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"))
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** Read the coverage ledger for a run; null when absent or invalid. */
export function readLedger(runDir: string): SecurityAuditLedger | null {
  return readValidated(join(runDir, COVERAGE_LEDGER_FILE), LedgerSchema)
}

/** Read findings for a run; null when absent or invalid. */
export function readFindings(runDir: string): SecurityAuditFinding[] | null {
  return readValidated(join(runDir, FINDINGS_FILE), FindingsSchema)
}

/** Read run metadata; null when absent or invalid. */
export function readRunMetadata(runDir: string): AuditRunMetadata | null {
  return readValidated(join(runDir, RUN_METADATA_FILE), RunMetadataSchema)
}

/**
 * Budget gate: an unfundable remainder forces ledger status `incomplete`
 * (unfunded units are deferred). Returns a new ledger object; never mutates.
 */
export function applyBudgetGate(ledger: SecurityAuditLedger, funded: boolean): SecurityAuditLedger {
  if (funded) {
    return ledger
  }
  return {
    units: ledger.units.map((unit) =>
      unit.status === "planned" || unit.status === "in_progress" ? { ...unit, status: "deferred" as const } : unit,
    ),
    status: "incomplete",
  }
}

export interface ResumeResult {
  ledger: SecurityAuditLedger | null
  findings: SecurityAuditFinding[]
  carried: SecurityAuditFinding[]
}

/**
 * Resume a run: read prior ledger + findings.
 * Carry rule (vendored Cloudflare): a prior `confirmed` finding with the same
 * source (same fingerprint + same title, description, and location.path) is
 * carried as-is; anything changed is NOT carried and must be revalidated by
 * the caller (fresh verifier pass).
 */
export function resumeRun(runDir: string, currentCandidates: SecurityAuditFinding[]): ResumeResult {
  const ledger = readLedger(runDir)
  const prior = readFindings(runDir) ?? []
  const priorByFingerprint = new Map(prior.map((finding) => [finding.fingerprint, finding]))
  const carried: SecurityAuditFinding[] = []
  for (const candidate of currentCandidates) {
    const previous = priorByFingerprint.get(candidate.fingerprint)
    if (
      previous !== undefined &&
      previous.status === "confirmed" &&
      previous.title === candidate.title &&
      previous.description === candidate.description &&
      previous.location.path === candidate.location.path
    ) {
      carried.push(previous)
    }
  }
  return { ledger, findings: prior, carried }
}
