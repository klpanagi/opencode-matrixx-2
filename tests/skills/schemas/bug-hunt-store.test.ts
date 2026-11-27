import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allocateRunId,
  assertRunId,
  assertWritableDir,
  COVERAGE_LEDGER_FILE,
  FINDINGS_FILE,
  getBugRunDir,
  getBugsDir,
  getReproducerDir,
  listBugRuns,
  readBugFindings,
  readBugLedger,
  readBugMetadata,
  readBugRun,
  RUN_METADATA_FILE,
  saveBugRun,
  type BugRunWriteArtifacts,
} from "../../../src/skills/loader/schemas/bug-hunt-store"
import type { BugFinding, BugHuntLedger, BugRunMetadata } from "../../../src/skills/loader/schemas/bug-hunt"

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
  const root = mkdtempSync(join(tmpdir(), "bug-hunt-store-test-"))
  roots.push(root)
  return root
}

function makeFinding(overrides: Partial<BugFinding> = {}): BugFinding {
  return {
    fingerprint: "repo/src/slice.ts:off-by-one",
    bug_class: "algorithms",
    tier: "E3",
    status: "confirmed",
    stage: "S4",
    title: "off-by-one drops the last element",
    description: "slice bound excludes the final element",
    severity: "high",
    location: { path: "src/slice.ts", lines: [12] },
    evidence: {
      oracle: "bun test tests/slice.test.ts",
      witness: "expected [1,2], received [1]",
      root_cause: "exclusive upper bound",
      remediation: "use an inclusive bound",
    },
    ...overrides,
  }
}

function makeArtifacts(overrides: Partial<BugRunWriteArtifacts> = {}): BugRunWriteArtifacts {
  const metadata: BugRunMetadata = {
    run: "run-1",
    startedAt: "2026-11-25T00:00:00Z",
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
  return {
    metadata,
    ledger,
    findings: [makeFinding()],
    ...overrides,
  }
}

describe("bug-hunt-store paths", () => {
  test("paths stay project-scoped", () => {
    //#given - a fresh project root
    const root = makeRoot()

    //#when - resolving the bugs paths
    const bugsDir = getBugsDir(root)
    const runDir = getBugRunDir(root, "run-1")

    //#then - both hang off <root>/.matrixx/bugs
    expect(bugsDir).toBe(join(root, ".matrixx", "bugs"))
    expect(runDir).toBe(join(root, ".matrixx", "bugs", "run-1"))
    expect(getReproducerDir(runDir)).toBe(join(root, ".matrixx", "bugs", "run-1", "reproducers"))
  })
})

describe("assertRunId", () => {
  test("rejects path-like, zero, and malformed run ids", () => {
    //#given - run ids that escape the bugs dir or break numbering
    const invalid = ["../x", "/abs", "run-0", "run-1/..", "run-01", ""]

    //#when/then - each is rejected
    for (const runId of invalid) {
      expect(() => assertRunId(runId)).toThrow(`invalid run id: ${runId}`)
    }
  })

  test("accepts a well-formed run id", () => {
    //#given - a canonical run id
    //#when/then - validation passes without throwing
    expect(() => assertRunId("run-1")).not.toThrow()
    expect(() => assertRunId("run-42")).not.toThrow()
  })
})

describe("allocateRunId", () => {
  test("allocates ascending run ids", () => {
    //#given - a fresh project root
    const root = makeRoot()

    //#when - two ids are allocated
    const first = allocateRunId(root)
    const second = allocateRunId(root)

    //#then - numbering starts at 1 and increments; both dirs exist
    expect(first).toBe("run-1")
    expect(second).toBe("run-2")
    expect(existsSync(getBugRunDir(root, first))).toBe(true)
    expect(existsSync(getBugRunDir(root, second))).toBe(true)
  })

  test("skips a pre-existing run directory", () => {
    //#given - run-1 already reserved on disk
    const root = makeRoot()
    mkdirSync(getBugRunDir(root, "run-1"), { recursive: true })

    //#when - allocating the next id
    const next = allocateRunId(root)

    //#then - the reservation is honoured
    expect(next).toBe("run-2")
  })
})

describe("allocateRunId symlink guard", () => {
  test("refuses a symlinked .matrixx and writes nothing outside the project", () => {
    //#given - .matrixx is a symlink to a directory outside the project
    const root = makeRoot()
    const outside = makeRoot()
    symlinkSync(outside, join(root, ".matrixx"), "dir")

    //#when - allocating a run id
    //#then - refused with the symlink error and no bugs dir appears outside
    expect(() => allocateRunId(root)).toThrow(/refusing to write through symlink/)
    expect(existsSync(join(outside, "bugs"))).toBe(false)
  })
})

describe("saveBugRun / readBugRun", () => {
  test("round-trips all three artifacts and creates reproducers/", () => {
    //#given - a complete set of artifacts for run-1
    const root = makeRoot()
    const artifacts = makeArtifacts()

    //#when - saved then read back
    saveBugRun(root, "run-1", artifacts)
    const readBack = readBugRun(root, "run-1")

    //#then - the snapshot matches and the reproducer dir exists
    expect(readBack).toEqual(artifacts)
    expect(existsSync(getReproducerDir(getBugRunDir(root, "run-1")))).toBe(true)
  })

  test("each artifact is individually readable", () => {
    //#given - a saved run
    const root = makeRoot()
    const artifacts = makeArtifacts()
    const runDir = getBugRunDir(root, "run-1")
    saveBugRun(root, "run-1", artifacts)

    //#when - reading the individual files
    const metadata = readBugMetadata(runDir)
    const ledger = readBugLedger(runDir)
    const findings = readBugFindings(runDir)

    //#then - they equal what was written
    expect(metadata).toEqual(artifacts.metadata)
    expect(ledger).toEqual(artifacts.ledger)
    expect(findings).toEqual(artifacts.findings)
  })

  test("rejects invalid artifacts before writing", () => {
    //#given - an E0 finding that illegally carries a severity
    const root = makeRoot()
    const artifacts = makeArtifacts({
      findings: [makeFinding({ tier: "E0", status: "needs_validation", severity: "low" })],
    })

    //#when - saving
    //#then - validation throws and nothing is persisted
    expect(() => saveBugRun(root, "run-1", artifacts)).toThrow()
    expect(existsSync(getBugRunDir(root, "run-1"))).toBe(false)
  })

  test("rejects an invalid run id", () => {
    //#given - a traversal-style run id
    const root = makeRoot()

    //#when/then - saving refuses before touching disk
    expect(() => saveBugRun(root, "../x", makeArtifacts())).toThrow("invalid run id: ../x")
  })

  test("rejects metadata whose run does not match the target run id", () => {
    //#given - run-1 metadata aimed at the run-5 directory
    const root = makeRoot()

    //#when - saving
    //#then - refused before any write lands on disk
    expect(() => saveBugRun(root, "run-5", makeArtifacts())).toThrow(/does not match/)
    expect(existsSync(join(root, ".matrixx"))).toBe(false)
  })

  test("rejects a symlinked bugs dir instead of writing outside the project", () => {
    //#given - .matrixx/bugs points at a directory outside the project
    const root = makeRoot()
    const outside = makeRoot()
    mkdirSync(join(root, ".matrixx"), { recursive: true })
    symlinkSync(outside, getBugsDir(root), "dir")

    //#when - saving
    //#then - refused, and nothing is written through the link
    expect(() => saveBugRun(root, "run-1", makeArtifacts())).toThrow(/symlink/i)
    expect(existsSync(join(outside, "run-1"))).toBe(false)
  })

  test("metadata-only run surfaces null derived artifacts", () => {
    //#given - a run dir containing only valid metadata
    const root = makeRoot()
    const runDir = getBugRunDir(root, "run-1")
    mkdirSync(runDir, { recursive: true })
    const metadata = makeArtifacts().metadata
    writeFileSync(join(runDir, RUN_METADATA_FILE), JSON.stringify(metadata), "utf-8")

    //#when - reading the run
    const readBack = readBugRun(root, "run-1")

    //#then - metadata anchors the read; ledger/findings stay null
    expect(readBack).not.toBeNull()
    expect(readBack?.metadata).toEqual(metadata)
    expect(readBack?.ledger).toBeNull()
    expect(readBack?.findings).toBeNull()
  })

  test("missing run reads as null", () => {
    //#given - a project root with no bugs dir
    const root = makeRoot()

    //#when - reading a run that was never written
    //#then - null instead of throwing
    expect(readBugRun(root, "run-1")).toBeNull()
  })

  test("corrupt JSON reads as null, never throws", () => {
    //#given - a saved run whose files are then corrupted
    const root = makeRoot()
    const runDir = getBugRunDir(root, "run-1")
    saveBugRun(root, "run-1", makeArtifacts())
    writeFileSync(join(runDir, RUN_METADATA_FILE), "{not json", "utf-8")
    writeFileSync(join(runDir, COVERAGE_LEDGER_FILE), JSON.stringify({ units: "nope", status: "complete" }), "utf-8")
    writeFileSync(join(runDir, FINDINGS_FILE), JSON.stringify([{ tier: "E0", severity: "high" }]), "utf-8")

    //#when - reading the corrupted artifacts
    //#then - invalid shapes and broken JSON yield null
    expect(readBugMetadata(runDir)).toBeNull()
    expect(readBugLedger(runDir)).toBeNull()
    expect(readBugFindings(runDir)).toBeNull()
    expect(readBugRun(root, "run-1")).toBeNull()
  })
})

describe("listBugRuns", () => {
  test("returns run dirs in numeric ascending order", () => {
    //#given - run dirs created out of order, plus a non-run dir and a stray file
    const root = makeRoot()
    for (const runId of ["run-10", "run-1", "run-2"]) {
      mkdirSync(getBugRunDir(root, runId), { recursive: true })
    }
    mkdirSync(join(getBugsDir(root), "scratch"), { recursive: true })
    writeFileSync(join(getBugsDir(root), "notes.txt"), "ignore me", "utf-8")

    //#when - listing runs
    const runs = listBugRuns(root)

    //#then - numeric, ascending, and only run ids
    expect(runs).toEqual(["run-1", "run-2", "run-10"])
  })

  test("skips a regular file that merely looks like a run id", () => {
    //#given - a run dir plus a regular file named run-7
    const root = makeRoot()
    mkdirSync(getBugRunDir(root, "run-1"), { recursive: true })
    writeFileSync(join(getBugsDir(root), "run-7"), "not a dir", "utf-8")

    //#when - listing runs
    const runs = listBugRuns(root)

    //#then - only directories count as runs
    expect(runs).toEqual(["run-1"])
  })

  test("returns an empty array when the bugs dir is absent", () => {
    //#given - a project root with no bugs dir
    const root = makeRoot()

    //#when - listing runs
    //#then - empty array, never throwing
    expect(listBugRuns(root)).toEqual([])
  })
})

describe("assertWritableDir segment walk", () => {
  test("refuses a symlinked run-dir segment when called with a nested dir", () => {
    //#given - the run dir is a symlink pointing outside the project
    const root = makeRoot()
    const outside = makeRoot()
    mkdirSync(getBugsDir(root), { recursive: true })
    symlinkSync(outside, getBugRunDir(root, "run-1"), "dir")

    //#when - guarding a nested dir under the symlinked run
    //#then - the link is refused by the segment walk, not merely by containment
    expect(() => assertWritableDir(root, join(getBugRunDir(root, "run-1"), "fixes"))).toThrow(
      /refusing to write through symlink/,
    )
  })
})
