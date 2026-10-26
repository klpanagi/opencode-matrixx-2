import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  resumeRun,
  RUN_METADATA_FILE,
  writeAuditFile,
  type AuditRunMetadata,
} from "../../../src/skills/schemas/audits-store"
import type { SecurityAuditFinding, SecurityAuditLedger } from "../../../src/skills/schemas/security-audit"

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
})
