import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyBudgetGate,
  COVERAGE_LEDGER_FILE,
  FINDINGS_FILE,
  getAuditDir,
  getRunDir,
  readFindings,
  readLedger,
  readRunMetadata,
  readValidatedFile,
  resumeRun,
  RUN_METADATA_FILE,
  RunMetadataSchema,
  writeAuditFile,
  type AuditRunMetadata,
} from "../../../src/skills/loader/schemas/audits-store"
import type { SecurityAuditFinding, SecurityAuditLedger } from "../../../src/skills/loader/schemas/security-audit"

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "audits-store-test-"))
  roots.push(root)
  return root
}

function makeFinding(overrides: Partial<SecurityAuditFinding> = {}): SecurityAuditFinding {
  return {
    fingerprint: "repo/src/auth.ts:login",
    status: "confirmed",
    title: "Auth bypass",
    description: "Missing check allows bypass",
    severity: "high",
    location: { path: "src/auth.ts", lines: [42] },
    evidence: { root_cause: "no guard", execution: "call login", remediation: "add guard" },
    ...overrides,
  }
}

describe("audits-store", () => {
  test("paths stay project-scoped", () => {
    const root = makeRoot()
    expect(getAuditDir(root)).toBe(join(root, ".matrixx", "audits"))
    expect(getRunDir(root, "run-1")).toBe(join(root, ".matrixx", "audits", "run-1"))
  })

  test("write-read roundtrip is identical", () => {
    //#given a fresh run dir with a ledger, findings, and metadata
    const runDir = getRunDir(makeRoot(), "run-1")
    const ledger: SecurityAuditLedger = {
      units: [{ coverage_id: "repo/src/auth.ts", status: "covered" }],
      status: "complete",
    }
    const findings = [makeFinding()]
    const meta: AuditRunMetadata = { run: "run-1", startedAt: "2026-10-26T00:00:00Z", funded: true, status: "complete" }
    //#when each artifact is written atomically then read back
    writeAuditFile(runDir, COVERAGE_LEDGER_FILE, ledger)
    writeAuditFile(runDir, FINDINGS_FILE, findings)
    writeAuditFile(runDir, RUN_METADATA_FILE, meta)
    //#then reads return identical data
    expect(readLedger(runDir)).toEqual(ledger)
    expect(readFindings(runDir)).toEqual(findings)
    expect(readRunMetadata(runDir)).toEqual(meta)
  })

  test("resume carries prior confirmed same-source, changed revalidates", () => {
    //#given prior confirmed findings persisted from an earlier run
    const runDir = getRunDir(makeRoot(), "run-2")
    const prior = [
      makeFinding(),
      makeFinding({ fingerprint: "repo/src/other.ts:x", title: "Other", location: { path: "src/other.ts" } }),
    ]
    writeAuditFile(runDir, FINDINGS_FILE, prior)
    writeAuditFile(runDir, COVERAGE_LEDGER_FILE, { units: [], status: "complete" })
    //#when resuming with one identical and one changed candidate
    const same = makeFinding()
    const changed = makeFinding({ description: "Different description now" })
    const result = resumeRun(runDir, [same, changed])
    //#then only the identical source is carried; changed must revalidate
    expect(result.carried).toEqual([prior[0]])
    expect(result.findings).toEqual(prior)
    expect(result.ledger?.status).toBe("complete")
  })

  test("resume with no prior run yields empty findings and null ledger", () => {
    //#given a run dir that was never written
    const runDir = getRunDir(makeRoot(), "run-9")
    //#when resuming
    const result = resumeRun(runDir, [makeFinding()])
    //#then nothing is carried and the ledger is null
    expect(result.ledger).toBeNull()
    expect(result.findings).toEqual([])
    expect(result.carried).toEqual([])
  })

  test("unfundable budget forces incomplete with deferred remainder", () => {
    //#given a ledger with unfinished units
    const ledger: SecurityAuditLedger = {
      units: [
        { coverage_id: "repo/src/a.ts", status: "planned" },
        { coverage_id: "repo/src/b.ts", status: "covered" },
      ],
      status: "complete",
    }
    //#when the budget gate reports unfunded
    const gated = applyBudgetGate(ledger, false)
    //#then the run is incomplete and open units defer; input untouched
    expect(gated.status).toBe("incomplete")
    expect(gated.units).toEqual([
      { coverage_id: "repo/src/a.ts", status: "deferred" },
      { coverage_id: "repo/src/b.ts", status: "covered" },
    ])
    expect(ledger.status).toBe("complete")
    //#when funded the ledger passes through unchanged
    expect(applyBudgetGate(ledger, true)).toEqual(ledger)
  })

  test("mid-write abort leaves target absent", () => {
    //#given a run dir and a payload whose serialization throws mid-write
    const runDir = getRunDir(makeRoot(), "run-3")
    const target = join(runDir, FINDINGS_FILE)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    //#when the atomic write aborts
    expect(() => writeAuditFile(runDir, FINDINGS_FILE, circular)).toThrow()
    //#then the target file is absent and no tmp residue is a valid artifact
    expect(existsSync(target)).toBe(false)
  })

  test("corrupt files read as null, never throw", () => {
    //#given a run dir with corrupt JSON on disk
    const runDir = getRunDir(makeRoot(), "run-4")
    writeAuditFile(runDir, COVERAGE_LEDGER_FILE, { units: "not-an-array", status: "complete" })
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, FINDINGS_FILE), "{not json", "utf-8")
    //#when reading
    //#then invalid shapes yield null instead of throwing
    expect(readLedger(runDir)).toBeNull()
    expect(readFindings(runDir)).toBeNull()
    expect(readFileSync(join(runDir, FINDINGS_FILE), "utf-8")).toBe("{not json")
  })

  test("artifacts above the size cap read back as null", () => {
    //#given a schema-valid findings file padded past the 10 MiB cap
    const runDir = getRunDir(makeRoot(), "run-5")
    const target = join(runDir, FINDINGS_FILE)
    const capBytes = 10 * 1024 * 1024
    const chunk = " ".repeat(1024 * 1024)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(target, "[", "utf-8")
    for (let written = 0; written < capBytes + chunk.length; written += chunk.length) {
      appendFileSync(target, chunk, "utf-8")
    }
    appendFileSync(target, `${JSON.stringify(makeFinding())}]`, "utf-8")
    //#when reading the oversized artifact
    //#then it is treated as absent instead of being parsed
    expect(statSync(target).size).toBeGreaterThan(capBytes)
    expect(readFindings(runDir)).toBeNull()
  })

  test("small artifact round-trips through readValidatedFile", () => {
    //#given a fresh run dir and run metadata
    const runDir = getRunDir(makeRoot(), "run-6")
    const meta: AuditRunMetadata = { run: "run-6", startedAt: "2026-11-25T00:00:00Z", funded: true, status: "complete" }
    //#when written then read back through the validated reader
    writeAuditFile(runDir, RUN_METADATA_FILE, meta)
    //#then the parsed value matches what was written
    expect(readValidatedFile(join(runDir, RUN_METADATA_FILE), RunMetadataSchema)).toEqual(meta)
  })

  test("symlink to a valid artifact reads as null, never follows the link", () => {
    //#given a run dir whose artifact path is a symlink to a valid JSON file
    const root = makeRoot()
    const runDir = getRunDir(root, "run-10")
    mkdirSync(runDir, { recursive: true })
    const realFile = join(root, "real-metadata.json")
    const meta: AuditRunMetadata = { run: "run-10", startedAt: "2026-11-25T00:00:00Z", funded: true, status: "complete" }
    writeFileSync(realFile, JSON.stringify(meta), "utf-8")
    const artifactPath = join(runDir, RUN_METADATA_FILE)
    symlinkSync(realFile, artifactPath, "file")
    //#when reading through the symlink
    //#then the link is refused and the reader never throws
    expect(() => readValidatedFile(artifactPath, RunMetadataSchema)).not.toThrow()
    expect(readValidatedFile(artifactPath, RunMetadataSchema)).toBeNull()
  })

  test.skipIf(process.platform === "win32")("symlink to /dev/zero reads as null without hanging", () => {
    //#given an artifact path that is a symlink to the zero device
    const root = makeRoot()
    const runDir = getRunDir(root, "run-11")
    mkdirSync(runDir, { recursive: true })
    const artifactPath = join(runDir, RUN_METADATA_FILE)
    symlinkSync("/dev/zero", artifactPath, "file")
    //#when reading with a wall-clock bound
    const startedAt = Date.now()
    const value = readValidatedFile(artifactPath, RunMetadataSchema)
    const elapsed = Date.now() - startedAt
    //#then the reader returns null immediately instead of streaming forever
    expect(elapsed).toBeLessThan(1000)
    expect(value).toBeNull()
  })

  test.skipIf(process.platform === "win32")("FIFO at the artifact path reads as null without hanging", () => {
    //#given an artifact path that is a named pipe
    const root = makeRoot()
    const runDir = getRunDir(root, "run-12")
    mkdirSync(runDir, { recursive: true })
    const artifactPath = join(runDir, RUN_METADATA_FILE)
    execFileSync("mkfifo", [artifactPath])
    //#when reading with a wall-clock bound
    const startedAt = Date.now()
    const value = readValidatedFile(artifactPath, RunMetadataSchema)
    const elapsed = Date.now() - startedAt
    //#then the pipe is refused immediately instead of blocking on open
    expect(elapsed).toBeLessThan(1000)
    expect(value).toBeNull()
  })

  test("written artifacts are private (mode 0o600)", () => {
    //#given a fresh run dir
    const runDir = getRunDir(makeRoot(), "run-7")
    //#when an artifact is written atomically
    writeAuditFile(runDir, RUN_METADATA_FILE, { run: "run-7", startedAt: "2026-11-25T00:00:00Z", funded: true, status: "complete" })
    //#then the file mode is owner-only read/write
    expect(statSync(join(runDir, RUN_METADATA_FILE)).mode & 0o777).toBe(0o600)
  })

  test("successful write leaves no temp files behind", () => {
    //#given a fresh run dir
    const runDir = getRunDir(makeRoot(), "run-8")
    //#when an artifact is written atomically
    writeAuditFile(runDir, FINDINGS_FILE, [makeFinding()])
    //#then only the final artifact remains, with no `*.tmp.*` residue
    expect(readdirSync(runDir).filter((name) => name.includes(".tmp."))).toEqual([])
    expect(existsSync(join(runDir, FINDINGS_FILE))).toBe(true)
  })
})
