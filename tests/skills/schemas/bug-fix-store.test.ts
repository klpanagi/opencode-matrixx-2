import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FixRecord } from "../../../src/skills/loader/schemas/bug-fix"
import {
  encodeFingerprint,
  getFixEvidenceDir,
  getFixRecordPath,
  getFixesDir,
  getPatchesDir,
  listFixRecords,
  readFixRecord,
  saveFixRecord,
} from "../../../src/skills/loader/schemas/bug-fix-store"
import type { BugFinding, BugHuntLedger, BugRunMetadata } from "../../../src/skills/loader/schemas/bug-hunt"
import { getBugRunDir, saveBugRun, type BugRunWriteArtifacts } from "../../../src/skills/loader/schemas/bug-hunt-store"

const RUN_ID = "run-1"
const FINGERPRINT = "repo/src/slice.ts:off-by-one"
const OTHER_FINGERPRINT = "repo/src/other.ts:null-deref"

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
  const root = mkdtempSync(join(tmpdir(), "bug-fix-store-test-"))
  roots.push(root)
  return root
}

function sha(char = "a"): string {
  return char.repeat(64)
}

function makeFinding(overrides: Partial<BugFinding> = {}): BugFinding {
  return {
    fingerprint: FINGERPRINT,
    bug_class: "algorithms",
    tier: "E3",
    status: "confirmed",
    stage: "S4",
    title: "off-by-one drops the last element",
    description: "slice bound excludes the final element",
    severity: "high",
    location: { path: "src/slice.ts", lines: [12] },
    reproducer: "reproducers/slice.test.ts",
    evidence: {
      oracle: "bun test tests/slice.test.ts",
      witness: "expected [1,2], received [1]",
      root_cause: "exclusive upper bound",
      remediation: "use an inclusive bound",
    },
    ...overrides,
  }
}

function makeArtifacts(findings: BugFinding[] = [makeFinding()]): BugRunWriteArtifacts {
  const metadata: BugRunMetadata = {
    run: RUN_ID,
    startedAt: "2026-11-26T09:00:00Z",
    scope: "module",
    depth: "static",
    class_filter: "all",
    funded: true,
    status: "complete",
  }
  const ledger: BugHuntLedger = {
    units: [{ coverage_id: "surface/src/slice.ts", status: "covered" }],
    status: "complete",
  }
  return { metadata, ledger, findings }
}

function seedRun(root: string, findings: BugFinding[] = [makeFinding()]): string {
  saveBugRun(root, RUN_ID, makeArtifacts(findings))
  return getBugRunDir(root, RUN_ID)
}

function makeRecord(overrides: Partial<FixRecord> = {}): FixRecord {
  return {
    schema_version: 1,
    run: RUN_ID,
    finding_fingerprint: FINGERPRINT,
    status: "plausible",
    created_at: "2026-11-26T10:00:00Z",
    duration_ms: 412000,
    attempts: 1,
    options: {
      fix_budget: 5,
      max_attempts: 3,
      min_severity: "medium",
      mutation: false,
      allow_exec: true,
      verify: false,
    },
    sandbox: "timeout-only",
    finding: {
      tier: "E3",
      severity: "high",
      title: "off-by-one drops the last element",
      location: { path: "src/slice.ts", lines: [12] },
      reproducer: "reproducers/slice.test.ts",
    },
    reproducer: {
      path: "reproducers/slice.test.ts",
      signature_hash: sha("a"),
      pristine_runs: [
        { attempt: 1, exit_code: 1, signature_hash: sha("a") },
        { attempt: 2, exit_code: 1, signature_hash: sha("a") },
        { attempt: 3, exit_code: 1, signature_hash: sha("a") },
      ],
      pristine_failures: 3,
      deterministic: true,
      patched_passes: 3,
      patched_runs: [
        { attempt: 1, exit_code: 0 },
        { attempt: 2, exit_code: 0 },
        { attempt: 3, exit_code: 0 },
      ],
    },
    patch: {
      files: [{ path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") }],
      diff_path: "patches/src_slice_ts_off-by-one.diff",
      changed_lines: 4,
      commit_sha: "abcdef1",
    },
    gates: {
      G1: { status: "pass", detail: "manifest identical" },
      G2: { status: "pass", detail: "3/3 fail pristine, 3/3 pass patched" },
      G3: { status: "pass", detail: "suite green" },
      G4: { status: "pass", detail: "changed lines covered" },
    },
    independent_verification: {
      verifier: "merovingian",
      status: "pass",
      clean_checkout: true,
      detail: "reproduced on a clean checkout",
    },
    terminal_reason: "all gates passed; awaiting human review",
    ...overrides,
  }
}

function makeOtherFinding(): BugFinding {
  return makeFinding({
    fingerprint: OTHER_FINGERPRINT,
    title: "null deref on empty input",
    location: { path: "src/other.ts", lines: [7] },
    reproducer: "reproducers/other.test.ts",
  })
}

function makeOtherRecord(): FixRecord {
  return makeRecord({
    finding_fingerprint: OTHER_FINGERPRINT,
    finding: {
      tier: "E3",
      severity: "high",
      title: "null deref on empty input",
      location: { path: "src/other.ts", lines: [7] },
      reproducer: "reproducers/other.test.ts",
    },
    reproducer: {
      path: "reproducers/other.test.ts",
      signature_hash: sha("a"),
      pristine_runs: [
        { attempt: 1, exit_code: 1, signature_hash: sha("a") },
        { attempt: 2, exit_code: 1, signature_hash: sha("a") },
        { attempt: 3, exit_code: 1, signature_hash: sha("a") },
      ],
      pristine_failures: 3,
      deterministic: true,
      patched_passes: 3,
      patched_runs: [
        { attempt: 1, exit_code: 0 },
        { attempt: 2, exit_code: 0 },
        { attempt: 3, exit_code: 0 },
      ],
    },
  })
}

describe("bug-fix-store paths", () => {
  test("fixes, patches, and evidence hang off the run dir", () => {
    //#given - a project root and run id
    const root = makeRoot()
    const runDir = getBugRunDir(root, RUN_ID)
    const encoded = encodeFingerprint(FINGERPRINT)

    //#when/then - every path is run-scoped
    expect(getFixesDir(runDir)).toBe(join(root, ".matrixx", "bugs", RUN_ID, "fixes"))
    expect(getPatchesDir(runDir)).toBe(join(root, ".matrixx", "bugs", RUN_ID, "fixes", "patches"))
    expect(getFixEvidenceDir(runDir)).toBe(join(root, ".matrixx", "bugs", RUN_ID, "fixes", "evidence"))
    expect(getFixRecordPath(runDir, FINGERPRINT)).toBe(join(getFixesDir(runDir), `fix-${encoded}.json`))
  })
})

describe("encodeFingerprint", () => {
  test("encodes separators into a deterministic, filesystem-safe filename", () => {
    //#given - a fingerprint containing a slash and a colon
    //#when - encoded twice, plus a sibling fingerprint
    const encoded = encodeFingerprint("src/slice.ts:off-by-one")
    const again = encodeFingerprint("src/slice.ts:off-by-one")
    const other = encodeFingerprint("src/slice.ts:null-deref")

    //#then - filesystem-safe, deterministic, and distinct
    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(encoded.startsWith("src_slice.ts_off-by-one-")).toBe(true)
    expect(again).toBe(encoded)
    expect(other).not.toBe(encoded)
  })

  test("slug collisions stay distinct because of the hash suffix", () => {
    //#given - two fingerprints that sanitize to the same slug
    const a = encodeFingerprint("src/a:b")
    const b = encodeFingerprint("src/a_b")

    //#when - both are encoded
    //#then - the shared slug prefix is identical but the encoded names differ
    expect(a.startsWith("src_a_b-")).toBe(true)
    expect(b.startsWith("src_a_b-")).toBe(true)
    expect(a).not.toBe(b)
  })

  test("getFixRecordPath rejects a malformed fingerprint", () => {
    //#given - a fingerprint with a space
    //#when/then - path construction throws instead of producing a bad filename
    expect(() => getFixRecordPath("/tmp/run", "bad fingerprint!")).toThrow()
  })
})

describe("saveFixRecord / readFixRecord", () => {
  test("round-trips a record and writes it with mode 0600", () => {
    //#given - a seeded run and a plausible record
    const root = makeRoot()
    const runDir = seedRun(root)
    const record = makeRecord()

    //#when - saved then read back
    saveFixRecord(root, RUN_ID, record)
    const readBack = readFixRecord(runDir, FINGERPRINT)

    //#then - the snapshot matches and the file is private
    expect(readBack).toEqual(record)
    expect(statSync(getFixRecordPath(runDir, FINGERPRINT)).mode & 0o777).toBe(0o600)
  })

  test("creates both artifact directories", () => {
    //#given - a seeded run
    const root = makeRoot()
    const runDir = seedRun(root)

    //#when - saving a record
    saveFixRecord(root, RUN_ID, makeRecord())

    //#then - patches/ and evidence/ exist for the retry steps
    expect(existsSync(getPatchesDir(runDir))).toBe(true)
    expect(existsSync(getFixEvidenceDir(runDir))).toBe(true)
  })

  test("a second save replaces the record atomically", () => {
    //#given - an existing record for the fingerprint
    const root = makeRoot()
    const runDir = seedRun(root)
    saveFixRecord(root, RUN_ID, makeRecord())
    const replacement = makeRecord({
      status: "rejected",
      attempts: 2,
      updated_at: "2026-11-26T11:00:00Z",
      independent_verification: undefined,
      gates: { G2: { status: "fail", detail: "reproducer still fails" } },
      terminal_reason: "rejected after re-verification",
    })

    //#when - overwritten
    saveFixRecord(root, RUN_ID, replacement)

    //#then - the read returns only the replacement
    expect(readFixRecord(runDir, FINGERPRINT)).toEqual(replacement)
  })

  test("readFixRecord returns null for absent, invalid, oversized, and non-regular entries", () => {
    //#given - a seeded run with several malformed record slots
    const root = makeRoot()
    const runDir = seedRun(root)
    const fixesDir = getFixesDir(runDir)
    mkdirSync(fixesDir, { recursive: true })

    //#when/then - absent
    expect(readFixRecord(runDir, FINGERPRINT)).toBeNull()

    //#when/then - invalid JSON
    writeFileSync(getFixRecordPath(runDir, FINGERPRINT), "{not json", "utf-8")
    expect(readFixRecord(runDir, FINGERPRINT)).toBeNull()

    //#when/then - invalid shape
    writeFileSync(getFixRecordPath(runDir, FINGERPRINT), JSON.stringify({ status: "plausible" }), "utf-8")
    expect(readFixRecord(runDir, FINGERPRINT)).toBeNull()

    //#when/then - oversized
    writeFileSync(getFixRecordPath(runDir, FINGERPRINT), "x".repeat(10 * 1024 * 1024 + 1), "utf-8")
    expect(readFixRecord(runDir, FINGERPRINT)).toBeNull()

    //#when/then - a directory where the record should be
    rmSync(getFixRecordPath(runDir, FINGERPRINT), { force: true })
    mkdirSync(getFixRecordPath(runDir, FINGERPRINT))
    expect(readFixRecord(runDir, FINGERPRINT)).toBeNull()
  })
})

describe("saveFixRecord preconditions", () => {
  test("throws when the run metadata is absent", () => {
    //#given - a root with no bug-hunt run
    const root = makeRoot()

    //#when/then - refused before writing
    expect(() => saveFixRecord(root, RUN_ID, makeRecord())).toThrow(/no bug-hunt run/)
    expect(existsSync(join(root, ".matrixx"))).toBe(false)
  })

  test("throws when the finding fingerprint is unknown to the run", () => {
    //#given - a run whose findings do not include the record fingerprint
    const root = makeRoot()
    seedRun(root)
    const record = makeRecord({ finding_fingerprint: OTHER_FINGERPRINT })

    //#when/then - refused
    expect(() => saveFixRecord(root, RUN_ID, record)).toThrow(/not present in .*findings/)
  })

  test("throws when the run id does not match the record", () => {
    //#given - a record aimed at a different run
    const root = makeRoot()
    seedRun(root)
    const record = makeRecord({ run: "run-2" })

    //#when/then - refused
    expect(() => saveFixRecord(root, RUN_ID, record)).toThrow(/does not match/)
  })

  test("throws when the finding tier snapshot drifts", () => {
    //#given - a record snapshot claiming E2 for a seeded E3 finding
    const root = makeRoot()
    seedRun(root)
    const base = makeRecord()
    const record: FixRecord = { ...base, finding: { ...base.finding, tier: "E2" } }

    //#when/then - refused
    expect(() => saveFixRecord(root, RUN_ID, record)).toThrow(/tier/)
  })

  test("re-validates the record before writing", () => {
    //#given - a hand-edited record with an unsupported status
    const root = makeRoot()
    seedRun(root)
    const invalid = { ...makeRecord(), status: "fixed" } as unknown as FixRecord

    //#when/then - the store parses on save and refuses
    expect(() => saveFixRecord(root, RUN_ID, invalid)).toThrow()
  })
})

describe("saveFixRecord symlink guards", () => {
  test("refuses a symlinked fixes/ directory", () => {
    //#given - fixes/ pre-planted as a link outside the project
    const root = makeRoot()
    const runDir = seedRun(root)
    const outside = makeRoot()
    symlinkSync(outside, getFixesDir(runDir), "dir")

    //#when/then - refused, nothing written through the link
    expect(() => saveFixRecord(root, RUN_ID, makeRecord())).toThrow(/symlink/)
    expect(existsSync(join(outside, `fix-${encodeFingerprint(FINGERPRINT)}.json`))).toBe(false)
  })

  test("refuses symlinked patches/ and evidence/ directories", () => {
    //#given - fixes/ is real but its children are links outside the project
    const root = makeRoot()
    const runDir = seedRun(root)
    mkdirSync(getFixesDir(runDir), { recursive: true })
    const patchesOutside = makeRoot()
    symlinkSync(patchesOutside, getPatchesDir(runDir), "dir")

    //#when/then - patches symlink refused
    expect(() => saveFixRecord(root, RUN_ID, makeRecord())).toThrow(/symlink/)

    //#given - the patches link replaced by a real dir, evidence linked
    rmSync(getPatchesDir(runDir), { force: true })
    const evidenceOutside = makeRoot()
    symlinkSync(evidenceOutside, getFixEvidenceDir(runDir), "dir")

    //#when/then - evidence symlink refused too
    expect(() => saveFixRecord(root, RUN_ID, makeRecord())).toThrow(/symlink/)
  })

  test("refuses a deeper symlinked segment (the run dir itself)", () => {
    //#given - the run dir is moved outside and linked back into place
    const root = makeRoot()
    const runDir = seedRun(root)
    const outside = makeRoot()
    const outsideRunDir = join(outside, RUN_ID)
    renameSync(runDir, outsideRunDir)
    symlinkSync(outsideRunDir, runDir, "dir")

    //#when/then - the segment walk catches the run dir link
    expect(() => saveFixRecord(root, RUN_ID, makeRecord())).toThrow(/symlink/)
    expect(existsSync(getFixesDir(outsideRunDir))).toBe(false)
  })
})

describe("listFixRecords", () => {
  test("returns only valid records sorted by created_at then fingerprint", () => {
    //#given - two findings and two records written newest-first
    const root = makeRoot()
    const runDir = seedRun(root, [makeFinding(), makeOtherFinding()])
    saveFixRecord(root, RUN_ID, makeOtherRecord())
    saveFixRecord(root, RUN_ID, makeRecord({ created_at: "2026-11-26T09:00:00Z" }))

    //#when - listing
    const records = listFixRecords(runDir)

    //#then - earliest first, then fingerprint tie-break
    expect(records.map((record) => record.finding_fingerprint)).toEqual([FINGERPRINT, OTHER_FINGERPRINT])
  })

  test("breaks created_at ties by finding_fingerprint", () => {
    //#given - two records with the same timestamp
    const root = makeRoot()
    const runDir = seedRun(root, [makeFinding(), makeOtherFinding()])
    saveFixRecord(root, RUN_ID, makeOtherRecord())
    saveFixRecord(root, RUN_ID, makeRecord())

    //#when - listing
    const records = listFixRecords(runDir)

    //#then - `repo/src/other.ts...` sorts before `repo/src/slice.ts...`
    expect(records.map((record) => record.finding_fingerprint)).toEqual([OTHER_FINGERPRINT, FINGERPRINT])
  })

  test("ignores tmp files, invalid records, and non-record files", () => {
    //#given - one valid record plus three decoys
    const root = makeRoot()
    const runDir = seedRun(root)
    saveFixRecord(root, RUN_ID, makeRecord())
    const fixesDir = getFixesDir(runDir)
    writeFileSync(join(fixesDir, "fix-stray.json.tmp.123.abc"), "{}", "utf-8")
    writeFileSync(join(fixesDir, "fix-invalid.json"), "{}", "utf-8")
    writeFileSync(join(fixesDir, "notes.txt"), "ignore me", "utf-8")

    //#when - listing
    const records = listFixRecords(runDir)

    //#then - only the valid record survives
    expect(records).toHaveLength(1)
    expect(records[0].finding_fingerprint).toBe(FINGERPRINT)
  })

  test("returns an empty array when fixes/ is absent", () => {
    //#given - a seeded run with no fixes dir
    const root = makeRoot()
    const runDir = seedRun(root)

    //#when/then - empty, never throwing
    expect(listFixRecords(runDir)).toEqual([])
  })
})

describe("record integrity", () => {
  test("a record whose finding snapshot drifts from the run is refused", () => {
    //#given - a run and a record describing a different title
    const root = makeRoot()
    seedRun(root)
    const finding = makeRecord().finding

    //#when/then - every drift is refused
    expect(() => saveFixRecord(root, RUN_ID, makeRecord({ finding: { ...finding, title: "injected" } }))).toThrow(
      /title/,
    )
    expect(() =>
      saveFixRecord(root, RUN_ID, makeRecord({ finding: { ...finding, location: { path: "src/other.ts" } } })),
    ).toThrow(/location/)
    expect(() =>
      saveFixRecord(root, RUN_ID, makeRecord({ finding: { ...finding, reproducer: "reproducers/other.test.ts" } })),
    ).toThrow(/reproducer/)
  })

  test("reproducer.path must equal the finding reproducer", () => {
    //#given - a record pointing at a different reproducer file
    const root = makeRoot()
    seedRun(root)
    const reproducer = makeRecord().reproducer

    //#when/then - refused
    expect(() =>
      saveFixRecord(root, RUN_ID, makeRecord({ reproducer: { ...reproducer, path: "reproducers/other.test.ts" } })),
    ).toThrow(/reproducer.path/)
  })

  test("listing and reading ignore records from a foreign run or fingerprint", () => {
    //#given - a stored record whose run and fingerprint were tampered with
    const root = makeRoot()
    const runDir = seedRun(root)
    saveFixRecord(root, RUN_ID, makeRecord())
    const recordPath = getFixRecordPath(runDir, FINGERPRINT)
    const tampered = { ...makeRecord(), run: "run-2", finding_fingerprint: "src/other.ts:null-deref" }
    writeFileSync(recordPath, JSON.stringify(tampered), "utf-8")

    //#when - listing and reading
    const records = listFixRecords(runDir)
    const read = readFixRecord(runDir, FINGERPRINT)

    //#then - the tampered record is invisible
    expect(records).toEqual([])
    expect(read).toBeNull()
  })

  test("an abandoned record for an E0 finding with no reproducer is writable", () => {
    //#given - a run whose only finding is an E0 candidate with no reproducer
    const root = makeRoot()
    const e0 = makeFinding({
      fingerprint: "repo/src/parser.ts:overflow",
      tier: "E0",
      status: "needs_validation",
      severity: undefined,
      reproducer: undefined,
      title: "possible overflow in parser",
      location: { path: "src/parser.ts", lines: [3] },
    })
    const runDir = seedRun(root, [e0])
    const record = makeRecord({
      finding_fingerprint: e0.fingerprint,
      status: "abandoned",
      attempts: 0,
      finding: { tier: "E0", title: e0.title, location: e0.location },
      ineligible: { reason: "ineligible: tier E0 (requires E2/E3)" },
      reproducer: undefined,
      patch: undefined,
      gates: {},
      independent_verification: undefined,
      terminal_reason: "ineligible: tier E0 (requires E2/E3)",
    })

    //#when - saved and read back
    saveFixRecord(root, RUN_ID, record)
    const read = readFixRecord(runDir, e0.fingerprint)

    //#then - the refusal is recorded, not blocked by missing evidence
    expect(read?.status).toBe("abandoned")
    expect(read?.ineligible?.reason).toContain("E0")
  })

  test("a severity that drifts from the run finding is refused", () => {
    //#given - the stored finding is high, the record claims critical
    const root = makeRoot()
    seedRun(root)
    const record = makeRecord({ finding: { ...makeRecord().finding, severity: "critical" } })

    //#when/then - the drift is refused on severity
    expect(() => saveFixRecord(root, RUN_ID, record)).toThrow(/severity/)
  })

  test("a foreign run planting a record at the canonical path is not readable", () => {
    //#given - a record for run-2 stored under run-1 at the expected filename
    const root = makeRoot()
    const runDir = seedRun(root)
    saveFixRecord(root, RUN_ID, makeRecord())
    const recordPath = getFixRecordPath(runDir, FINGERPRINT)
    writeFileSync(recordPath, JSON.stringify({ ...makeRecord(), run: "run-2" }), "utf-8")

    //#when - reading by the matching fingerprint
    const read = readFixRecord(runDir, FINGERPRINT)

    //#then - the run binding wins over the fingerprint match
    expect(read).toBeNull()
  })

  test("a fingerprint that drifts from the requested one is not readable", () => {
    //#given - a same-run record stored at the canonical path for a different fingerprint
    const root = makeRoot()
    const runDir = seedRun(root)
    saveFixRecord(root, RUN_ID, makeRecord())
    const recordPath = getFixRecordPath(runDir, FINGERPRINT)
    writeFileSync(
      recordPath,
      JSON.stringify({ ...makeRecord(), finding_fingerprint: "repo/src/other.ts:null-deref" }),
      "utf-8",
    )

    //#when - read by the fingerprinted path
    const read = readFixRecord(runDir, FINGERPRINT)

    //#then - the fingerprint binding refuses it
    expect(read).toBeNull()
  })
})

describe("fingerprint encoding collisions", () => {
  test("different fingerprints that slugify identically still differ", () => {
    //#given - two fingerprints whose slugs collapse to the same text
    const left = "src/a.ts:x"
    const right = "src?a.ts:x"

    //#when - encoded
    const leftEncoded = encodeFingerprint(left)
    const rightEncoded = encodeFingerprint(right)

    //#then - the hash suffix keeps them distinct
    expect(leftEncoded).not.toBe(rightEncoded)
  })
})
