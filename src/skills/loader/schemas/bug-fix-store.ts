import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { readValidatedFile, writeAuditFile } from "./audits-store"
import { EVIDENCE_DIR_NAME, type FixRecord, FixRecordSchema, PATCHES_DIR_NAME } from "./bug-fix"
import { RUN_ID_PATTERN } from "./bug-hunt"
import { assertRunId, assertWritableDir, assertWritableRunDir, readBugRun } from "./bug-hunt-store"
import { FingerprintSchema } from "./security-audit"

const FIXES_DIR_NAME = "fixes"
const FIX_RECORD_PATTERN = /^fix-.*\.json$/
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]/g

export function getFixesDir(runDir: string): string {
  return join(runDir, FIXES_DIR_NAME)
}

export function getPatchesDir(runDir: string): string {
  return join(getFixesDir(runDir), PATCHES_DIR_NAME)
}

export function getFixEvidenceDir(runDir: string): string {
  return join(getFixesDir(runDir), EVIDENCE_DIR_NAME)
}

export function encodeFingerprint(fingerprint: string): string {
  const slug = fingerprint.replace(UNSAFE_FILENAME_CHARS, "_")
  return `${slug}-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`
}

export function getFixRecordPath(runDir: string, fingerprint: string): string {
  FingerprintSchema.parse(fingerprint)
  return join(getFixesDir(runDir), `fix-${encodeFingerprint(fingerprint)}.json`)
}

export function saveFixRecord(projectRoot: string, runId: string, record: FixRecord): void {
  const parsed = FixRecordSchema.parse(record)
  assertRunId(runId)
  if (parsed.run !== runId) {
    throw new Error(`record run ${parsed.run} does not match run directory ${runId}`)
  }
  const artifacts = readBugRun(projectRoot, runId)
  if (artifacts === null) {
    throw new Error(`no bug-hunt run found for ${runId}`)
  }
  const finding = artifacts.findings?.find((entry) => entry.fingerprint === parsed.finding_fingerprint)
  if (finding === undefined) {
    throw new Error(`finding ${parsed.finding_fingerprint} is not present in ${runId} findings`)
  }
  if (finding.tier !== parsed.finding.tier) {
    throw new Error(`finding snapshot tier ${parsed.finding.tier} does not match run tier ${finding.tier}`)
  }
  if (parsed.finding.title !== finding.title) {
    throw new Error(`finding snapshot title does not match the run finding ${finding.fingerprint}`)
  }
  if (
    parsed.finding.severity !== undefined &&
    finding.severity !== undefined &&
    parsed.finding.severity !== finding.severity
  ) {
    throw new Error(`finding snapshot severity does not match the run finding ${finding.fingerprint}`)
  }
  if (parsed.finding.location.path !== finding.location.path) {
    throw new Error(`finding snapshot location does not match the run finding ${finding.fingerprint}`)
  }
  if (parsed.status !== "abandoned" && finding.reproducer === undefined) {
    throw new Error(`the run finding ${finding.fingerprint} has no reproducer to bind to`)
  }
  if (
    parsed.finding.reproducer !== undefined &&
    parsed.finding.reproducer !== finding.reproducer
  ) {
    throw new Error(`finding snapshot reproducer does not match the run finding ${finding.fingerprint}`)
  }
  if (parsed.reproducer !== undefined && parsed.reproducer.path !== finding.reproducer) {
    throw new Error("reproducer.path must equal the finding reproducer path")
  }
  const runDir = assertWritableRunDir(projectRoot, runId)
  const fixesDir = getFixesDir(runDir)
  const patchesDir = getPatchesDir(runDir)
  const evidenceDir = getFixEvidenceDir(runDir)
  for (const dir of [fixesDir, patchesDir, evidenceDir]) {
    assertWritableDir(projectRoot, dir)
    mkdirSync(dir, { recursive: true })
  }
  const recordPath = getFixRecordPath(runDir, parsed.finding_fingerprint)
  writeAuditFile(fixesDir, basename(recordPath), parsed)
}

export function readFixRecord(runDir: string, fingerprint: string): FixRecord | null {
  const record = readValidatedFile(getFixRecordPath(runDir, fingerprint), FixRecordSchema)
  if (record === null || record.finding_fingerprint !== fingerprint) {
    return null
  }
  const expectedRun = basename(runDir)
  if (RUN_ID_PATTERN.test(expectedRun) && record.run !== expectedRun) {
    return null
  }
  return record
}

export function listFixRecords(runDir: string): FixRecord[] {
  const fixesDir = getFixesDir(runDir)
  if (!existsSync(fixesDir)) {
    return []
  }
  const expectedRun = basename(runDir)
  const matchesRun = !RUN_ID_PATTERN.test(expectedRun)
  const records: FixRecord[] = []
  for (const entry of readdirSync(fixesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !FIX_RECORD_PATTERN.test(entry.name)) {
      continue
    }
    const record = readValidatedFile(join(fixesDir, entry.name), FixRecordSchema)
    if (record !== null && (matchesRun || record.run === expectedRun)) {
      records.push(record)
    }
  }
  return records.sort((left, right) => {
    const byDate = left.created_at.localeCompare(right.created_at)
    return byDate !== 0 ? byDate : left.finding_fingerprint.localeCompare(right.finding_fingerprint)
  })
}
