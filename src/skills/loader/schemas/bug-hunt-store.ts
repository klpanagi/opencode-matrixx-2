import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import {
  COVERAGE_LEDGER_FILE,
  FINDINGS_FILE,
  RUN_METADATA_FILE,
  readValidatedFile,
  writeAuditFile,
} from "./audits-store"
import {
  type BugFinding,
  BugFindingsSchema,
  type BugHuntLedger,
  BugHuntLedgerSchema,
  type BugRunMetadata,
  BugRunMetadataSchema,
  REPRODUCERS_DIR_NAME,
  RUN_ID_PATTERN,
} from "./bug-hunt"

export const BUGS_DIR_NAME = "bugs"
export { COVERAGE_LEDGER_FILE, FINDINGS_FILE, REPRODUCERS_DIR_NAME, RUN_METADATA_FILE }

/** Read contract: metadata anchors the run; derived artifacts may be missing. */
export interface BugRunArtifacts {
  metadata: BugRunMetadata
  ledger: BugHuntLedger | null
  findings: BugFinding[] | null
}

export interface BugRunWriteArtifacts {
  metadata: BugRunMetadata
  ledger: BugHuntLedger
  findings: BugFinding[]
}

export function getBugsDir(projectRoot: string): string {
  return join(projectRoot, ".matrixx", BUGS_DIR_NAME)
}

export function getBugRunDir(projectRoot: string, runId: string): string {
  return join(getBugsDir(projectRoot), runId)
}

export function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`invalid run id: ${runId}`)
  }
}

/**
 * Race-safe run id allocation: the exclusive mkdir IS the reservation, so two
 * concurrent callers can never claim the same `run-<n>`.
 */
export function allocateRunId(projectRoot: string): string {
  assertWritableDir(projectRoot, getBugsDir(projectRoot))
  mkdirSync(getBugsDir(projectRoot), { recursive: true })
  for (let n = 1; n <= 1_000_000; n++) {
    const runId = `run-${n}`
    try {
      mkdirSync(getBugRunDir(projectRoot, runId), { recursive: false })
      return runId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        continue
      }
      throw error
    }
  }
  throw new Error("could not allocate run id")
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }
}

function deepestExistingAncestor(path: string): string {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      return current
    }
    current = parent
  }
  return current
}

/**
 * Refuse to write through a symlinked `.matrixx`, `bugs`, or target dir, and
 * refuse any resolved target outside the project root.
 */
function assertWritableDir(projectRoot: string, dir: string): void {
  for (const component of [join(projectRoot, ".matrixx"), getBugsDir(projectRoot), dir]) {
    if (isSymlink(component)) {
      throw new Error(`refusing to write through symlink: ${component}`)
    }
  }
  const realRoot = existsSync(projectRoot) ? realpathSync(projectRoot) : resolve(projectRoot)
  const resolved = realpathSync(deepestExistingAncestor(dir))
  if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`refusing to write outside the project: ${resolved}`)
  }
}

function assertWritableRunDir(projectRoot: string, runId: string): string {
  const runDir = getBugRunDir(projectRoot, runId)
  assertWritableDir(projectRoot, runDir)
  return runDir
}

export function getReproducerDir(runDir: string): string {
  return join(runDir, REPRODUCERS_DIR_NAME)
}

export function saveBugRun(projectRoot: string, runId: string, artifacts: BugRunWriteArtifacts): void {
  assertRunId(runId)
  const metadata = BugRunMetadataSchema.parse(artifacts.metadata)
  const ledger = BugHuntLedgerSchema.parse(artifacts.ledger)
  const findings = BugFindingsSchema.parse(artifacts.findings)
  if (metadata.run !== runId) {
    throw new Error(`metadata run ${metadata.run} does not match requested run id ${runId}`)
  }
  const runDir = assertWritableRunDir(projectRoot, runId)
  mkdirSync(getReproducerDir(runDir), { recursive: true })
  writeAuditFile(runDir, RUN_METADATA_FILE, metadata)
  writeAuditFile(runDir, COVERAGE_LEDGER_FILE, ledger)
  writeAuditFile(runDir, FINDINGS_FILE, findings)
}

export function readBugMetadata(runDir: string): BugRunMetadata | null {
  return readValidatedFile(join(runDir, RUN_METADATA_FILE), BugRunMetadataSchema)
}

export function readBugLedger(runDir: string): BugHuntLedger | null {
  return readValidatedFile(join(runDir, COVERAGE_LEDGER_FILE), BugHuntLedgerSchema)
}

export function readBugFindings(runDir: string): BugFinding[] | null {
  return readValidatedFile(join(runDir, FINDINGS_FILE), BugFindingsSchema)
}

export function readBugRun(projectRoot: string, runId: string): BugRunArtifacts | null {
  assertRunId(runId)
  const runDir = getBugRunDir(projectRoot, runId)
  const metadata = readBugMetadata(runDir)
  if (metadata === null) {
    return null
  }
  return {
    metadata,
    ledger: readBugLedger(runDir),
    findings: readBugFindings(runDir),
  }
}

export function listBugRuns(projectRoot: string): string[] {
  const bugsDir = getBugsDir(projectRoot)
  if (!existsSync(bugsDir)) {
    return []
  }
  return readdirSync(bugsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice("run-".length)) - Number(b.slice("run-".length)))
}
