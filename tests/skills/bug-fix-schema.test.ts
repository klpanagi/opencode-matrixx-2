import { describe, expect, test } from "bun:test"
import { FixRecordSchema } from "../../src/skills/loader/schemas/bug-fix"

type Json = Record<string, unknown>

interface IssueLike {
  message: string
  path: PropertyKey[]
}

function sha(char = "a"): string {
  return char.repeat(64)
}

function merge(base: Json, patch: Json): Json {
  const out: Json = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = merge(current, value)
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function passingGates(extra: Json = {}): Json {
  return {
    G1: { status: "pass", detail: "manifest identical" },
    G2: { status: "pass", detail: "3/3 fail pristine, 3/3 pass patched" },
    G3: { status: "pass", detail: "suite green" },
    G4: { status: "pass", detail: "changed lines covered" },
    ...extra,
  }
}

function baseRecord(): Json {
  return {
    schema_version: 1,
    run: "run-7",
    finding_fingerprint: "src/slice.ts:off-by-one",
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
      tier: "E2",
      severity: "medium",
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
    gates: passingGates(),
    independent_verification: {
      verifier: "merovingian",
      status: "pass",
      clean_checkout: true,
      detail: "reproduced on a clean checkout",
    },
    terminal_reason: "all gates passed; awaiting human review",
  }
}

function makeRecord(patch: Json = {}): Json {
  return merge(baseRecord(), patch)
}

function makeRecordWithEmptyGates(patch: Json = {}): Json {
  const record = makeRecord(patch)
  record.gates = {}
  return record
}

function failingIssues(record: Json): IssueLike[] {
  const result = FixRecordSchema.safeParse(record)
  expect(result.success).toBe(false)
  return result.error?.issues ?? []
}

function expectPath(issues: IssueLike[], path: PropertyKey[]): void {
  expect(issues.map((issue) => [...issue.path])).toContainEqual(path)
}

describe("FixRecordSchema positive shapes", () => {
  test("a minimal plausible record parses", () => {
    //#given - a plausible record with all gates passing
    //#when - parsed
    //#then - accepted
    expect(FixRecordSchema.safeParse(makeRecord()).success).toBe(true)
  })

  test("each terminal status parses with its minimal shape", () => {
    //#given - one valid record per status
    const records: Json[] = [
      makeRecord({
        status: "rejected",
        attempts: 1,
        gates: { G2: { status: "fail", detail: "reproducer still fails" } },
        independent_verification: undefined,
      }),
      makeRecordWithEmptyGates({
        status: "abandoned",
        attempts: 0,
        ineligible: { reason: "tier E1 is not eligible" },
        patch: undefined,
        reproducer: undefined,
        independent_verification: undefined,
        terminal_reason: "refused: tier E1 is not eligible",
      }),
      makeRecordWithEmptyGates({
        status: "abandoned",
        attempts: 0,
        patch: undefined,
        reproducer: undefined,
        independent_verification: undefined,
        terminal_reason: "circuit breaker: 2 consecutive rejections",
      }),
      makeRecordWithEmptyGates({
        status: "unreproducible",
        attempts: 0,
        patch: undefined,
        independent_verification: undefined,
        reproducer: {
          deterministic: false,
          pristine_failures: 1,
          patched_passes: undefined,
          patched_runs: undefined,
        },
        terminal_reason: "pristine runs diverged",
      }),
      makeRecordWithEmptyGates({
        status: "unreproducible",
        attempts: 0,
        patch: undefined,
        independent_verification: undefined,
        reproducer: {
          deterministic: true,
          pristine_failures: 2,
          patched_passes: undefined,
          patched_runs: undefined,
        },
        terminal_reason: "fewer than three pristine failures",
      }),
    ]

    //#when/then - every status parses
    for (const record of records) {
      expect(FixRecordSchema.safeParse(record).success).toBe(true)
    }
  })

  test("a regression test parses when the patch contains the same tests/ path", () => {
    //#given - one source file plus the matching regression test
    const record = makeRecord({
      patch: {
        files: [
          { path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") },
          { path: "tests/src/slice.test.ts", before_sha256: null, after_sha256: sha("d") },
        ],
      },
      regression_test: {
        path: "tests/src/slice.test.ts",
        failed_on_pristine: true,
        before_absent: true,
        pristine_failure_signature: sha("e"),
        evidence_path: "evidence/pristine-regression-fail.log",
        diff_path: "patches/regression-test.diff",
      },
    })

    //#when/then - accepted
    expect(FixRecordSchema.safeParse(record).success).toBe(true)
  })

  test("a blocked G5 with an install hint parses", () => {
    //#given - an optional mutation gate that is blocked with a hint
    const record = makeRecord({
      options: { mutation: true },
      gates: passingGates({
        G5: { status: "blocked", detail: "stryker missing", install_hint: "bun add -d @stryker-mutator/core" },
      }),
    })

    //#when/then - accepted
    expect(FixRecordSchema.safeParse(record).success).toBe(true)
  })
})

describe("plausible requirements", () => {
  test("each missing or failing requirement is rejected on its own path", () => {
    //#given - one plausible record per broken requirement
    const cases: Array<{ record: Json; path: PropertyKey[] }> = [
      { record: makeRecord({ patch: undefined }), path: ["patch"] },
      { record: makeRecord({ reproducer: undefined }), path: ["reproducer"] },
      {
        record: makeRecord({ independent_verification: undefined }),
        path: ["independent_verification"],
      },
      {
        record: makeRecord({ independent_verification: { status: "fail" } }),
        path: ["independent_verification", "status"],
      },
      { record: makeRecord({ gates: { G4: undefined } }), path: ["gates", "G4"] },
      {
        record: makeRecord({ gates: { G4: { status: "fail", detail: "line uncovered" } } }),
        path: ["gates", "G4"],
      },
      { record: makeRecord({ gates: { G5: { status: "fail", detail: "survived" } } }), path: ["gates", "G5"] },
      { record: makeRecord({ reproducer: { deterministic: false } }), path: ["reproducer", "deterministic"] },
      { record: makeRecord({ reproducer: { pristine_failures: 2 } }), path: ["reproducer", "pristine_failures"] },
      { record: makeRecord({ reproducer: { patched_passes: 2 } }), path: ["reproducer", "patched_passes"] },
      { record: makeRecord({ patch: { changed_lines: 61 } }), path: ["patch", "changed_lines"] },
      { record: makeRecord({ ineligible: { reason: "not actually eligible" } }), path: ["ineligible"] },
    ]

    //#when/then - each fails on the specific path
    for (const { record, path } of cases) {
      expectPath(failingIssues(record), path)
    }
  })

  test("a plausible record cannot rest on an ineligible tier", () => {
    //#given - an E0 and an E1 finding claim a fully verified plausible patch
    //#when - both are parsed
    //#then - the tier rule refuses each, whatever the gates say
    expectPath(
      failingIssues(makeRecord({ status: "plausible", finding: { tier: "E0" } })),
      ["finding", "tier"],
    )
    expectPath(
      failingIssues(makeRecord({ status: "plausible", finding: { tier: "E1" } })),
      ["finding", "tier"],
    )
  })

  test("a plausible record must carry the finding reproducer", () => {
    //#given - a plausible record whose finding has no reproducer
    const record = makeRecord({ status: "plausible" })
    delete (record.finding as Json).reproducer

    //#when/then - the binding rule refuses it
    expectPath(failingIssues(record), ["finding", "reproducer"])
  })

  test("a plausible record cannot carry four patch files", () => {
    //#given - a patch touching four source files
    const record = makeRecord({
      patch: {
        files: ["a", "b", "c", "d"].map((name) => ({
          path: `src/${name}.ts`,
          before_sha256: sha("b"),
          after_sha256: sha("c"),
        })),
      },
    })

    //#when/then - rejected on the files array
    expectPath(failingIssues(record), ["patch", "files"])
  })
})

describe("rejected requirements", () => {
  test("needs an attempt or a failing gate", () => {
    //#given - attempts 0 with every gate passing
    const record = makeRecord({
      status: "rejected",
      attempts: 0,
      gates: passingGates(),
      independent_verification: undefined,
    })

    //#when/then - rejected on the gates aggregate
    expectPath(failingIssues(record), ["gates"])
  })

  test("forbids ineligible", () => {
    //#given - a rejected record that also claims ineligibility
    const record = makeRecord({
      status: "rejected",
      attempts: 1,
      gates: { G2: { status: "fail", detail: "still fails" } },
      ineligible: { reason: "contradictory" },
      independent_verification: undefined,
    })

    //#when/then - rejected on ineligible
    expectPath(failingIssues(record), ["ineligible"])
  })
})

describe("abandoned requirements", () => {
  test("needs ineligible or a circuit-breaker reason", () => {
    //#given - an abandoned record with an unrelated reason
    const record = makeRecord({
      status: "abandoned",
      attempts: 0,
      patch: undefined,
      reproducer: undefined,
      independent_verification: undefined,
      gates: {},
      terminal_reason: "gave up",
    })

    //#when/then - rejected on terminal_reason
    expectPath(failingIssues(record), ["terminal_reason"])
  })

  test("an ineligible refusal must be clean", () => {
    //#given - an ineligible refusal carrying attempts, a patch, and gates
    const record = makeRecord({
      status: "abandoned",
      attempts: 1,
      ineligible: { reason: "tier E1" },
      gates: { G1: { status: "skipped", detail: "not attempted" } },
      reproducer: undefined,
      independent_verification: undefined,
    })

    //#when - parsed
    const issues = failingIssues(record)

    //#then - attempts, patch, and gates all rejected
    expectPath(issues, ["attempts"])
    expectPath(issues, ["patch"])
    expectPath(issues, ["gates"])
  })
})

describe("unreproducible requirements", () => {
  test("requires nondeterminism or fewer than three pristine failures", () => {
    //#given - a deterministic reproducer that failed three times
    const record = makeRecord({
      status: "unreproducible",
      attempts: 0,
      patch: undefined,
      independent_verification: undefined,
      gates: {},
      reproducer: { deterministic: true, pristine_failures: 3 },
      terminal_reason: "should not be unreproducible",
    })

    //#when/then - rejected on the reproducer
    expectPath(failingIssues(record), ["reproducer"])
  })

  test("forbids patch, verification, attempts, and a passing G2", () => {
    //#given - an unreproducible record carrying artefacts it cannot have
    const record = makeRecord({
      status: "unreproducible",
      attempts: 1,
      reproducer: { deterministic: false },
      gates: { G2: { status: "pass", detail: "contradictory" } },
      terminal_reason: "diverged",
    })

    //#when - parsed
    const issues = failingIssues(record)

    //#then - patch, verification, attempts, and G2 all rejected
    expectPath(issues, ["patch"])
    expectPath(issues, ["independent_verification"])
    expectPath(issues, ["attempts"])
    expectPath(issues, ["gates", "G2"])
  })
})

describe("regression test cross-cutting guards", () => {
  const validRegression = {
    path: "tests/src/slice.test.ts",
    failed_on_pristine: true,
    before_absent: true,
    pristine_failure_signature: sha("e"),
    evidence_path: "evidence/pristine-regression-fail.log",
    diff_path: "patches/regression-test.diff",
  }
  const withTestFile = (path: string): Json => ({
    files: [
      { path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") },
      { path, before_sha256: null, after_sha256: sha("d") },
    ],
  })

  test("rejects an invalid path, failed_on_pristine false, and before_absent false", () => {
    //#given - three malformed regression tests
    const cases: Array<{ record: Json; path: PropertyKey[] }> = [
      {
        record: makeRecord({ patch: withTestFile("src/x.test.ts"), regression_test: { ...validRegression, path: "src/x.test.ts" } }),
        path: ["regression_test", "path"],
      },
      {
        record: makeRecord({ patch: withTestFile(validRegression.path), regression_test: { ...validRegression, failed_on_pristine: false } }),
        path: ["regression_test", "failed_on_pristine"],
      },
      {
        record: makeRecord({ patch: withTestFile(validRegression.path), regression_test: { ...validRegression, before_absent: false } }),
        path: ["regression_test", "before_absent"],
      },
    ]

    //#when/then - each fails on its own field
    for (const { record, path } of cases) {
      expectPath(failingIssues(record), path)
    }
  })

  test("requires the regression path to appear in patch.files", () => {
    //#given - a regression test the patch never touches
    const record = makeRecord({
      patch: withTestFile("tests/src/other.test.ts"),
      regression_test: validRegression,
    })

    //#when/then - rejected on the regression path
    expectPath(failingIssues(record), ["regression_test", "path"])
  })

  test("rejects two tests/ paths and a tests/ path without a regression test", () => {
    //#given - a patch touching two tests files, and one touching a tests file alone
    const twoTests = makeRecord({
      patch: {
        files: [
          { path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") },
          { path: "tests/src/a.test.ts", before_sha256: null, after_sha256: sha("d") },
          { path: "tests/src/b.test.ts", before_sha256: null, after_sha256: sha("e") },
        ],
      },
      regression_test: { ...validRegression, path: "tests/src/a.test.ts" },
    })
    const noRegression = makeRecord({ patch: withTestFile("tests/src/a.test.ts") })

    //#when/then - both are rejected on patch.files
    expectPath(failingIssues(twoTests), ["patch", "files"])
    expectPath(failingIssues(noRegression), ["patch", "files"])
  })

  test("requires a patch alongside the regression test", () => {
    //#given - a regression test with no patch
    const record = makeRecord({ patch: undefined, regression_test: validRegression })

    //#when/then - rejected on the regression test
    expectPath(failingIssues(record), ["regression_test"])
  })

  test("confines the regression evidence and diff paths", () => {
    //#given - evidence outside evidence/ and a diff outside patches/
    const cases: Array<{ record: Json; path: PropertyKey[] }> = [
      {
        record: makeRecord({
          patch: withTestFile(validRegression.path),
          regression_test: { ...validRegression, evidence_path: "patches/leak.log" },
        }),
        path: ["regression_test", "evidence_path"],
      },
      {
        record: makeRecord({
          patch: withTestFile(validRegression.path),
          regression_test: { ...validRegression, diff_path: "evidence/leak.diff" },
        }),
        path: ["regression_test", "diff_path"],
      },
    ]

    //#when/then - each fails on its own field
    for (const { record, path } of cases) {
      expectPath(failingIssues(record), path)
    }
  })
})

describe("path confinement", () => {
  test("rejects absolute, traversal, and percent-encoded patch paths", () => {
    //#given - three illegal patch file paths
    const paths = ["/etc/passwd", "../src/slice.ts", "src%2fslice.ts"]

    //#when/then - each fails on that file entry
    for (const path of paths) {
      const record = makeRecord({
        patch: { files: [{ path, before_sha256: sha("b"), after_sha256: sha("c") }] },
      })
      expectPath(failingIssues(record), ["patch", "files", 0, "path"])
    }
  })

  test("confines patch.diff_path under patches/", () => {
    //#given - a diff stored outside patches/
    const record = makeRecord({ patch: { diff_path: "src/leak.diff" } })

    //#when/then - rejected on diff_path
    expectPath(failingIssues(record), ["patch", "diff_path"])
  })

  test("confines finding snapshot paths", () => {
    //#given - a reproducer and location that escape their allowed roots
    const escapedReproducer = makeRecord({ finding: { reproducer: "src/slice.test.ts" } })
    const escapedLocation = makeRecord({ finding: { location: { path: "../outside.ts" } } })

    //#when/then - each fails on the nested path
    expectPath(failingIssues(escapedReproducer), ["finding", "reproducer"])
    expectPath(failingIssues(escapedLocation), ["finding", "location", "path"])
  })
})

describe("gate rules", () => {
  test("a blocked gate needs an install hint and only blocked gates may carry one", () => {
    //#given - a blocked G5 without a hint and a passing G1 with a hint
    const blockedWithoutHint = makeRecord({ gates: { G5: { status: "blocked", detail: "missing" } } })
    const hintOnPass = makeRecord({
      gates: { G1: { status: "pass", detail: "ok", install_hint: "bun add x" } },
    })

    //#when/then - each fails on the gate's install_hint
    expectPath(failingIssues(blockedWithoutHint), ["gates", "G5", "install_hint"])
    expectPath(failingIssues(hintOnPass), ["gates", "G1", "install_hint"])
  })

  test("confines gate evidence under evidence/", () => {
    //#given - gate evidence stored under patches/
    const record = makeRecord({
      gates: { G1: { status: "pass", detail: "ok", evidence_path: "patches/manifest.txt" } },
    })

    //#when/then - rejected on the gate evidence path
    expectPath(failingIssues(record), ["gates", "G1", "evidence_path"])
  })
})

describe("hashes, enums, and strict objects", () => {
  test("rejects malformed sha256 and commit_sha values", () => {
    //#given - short, long, and uppercase hashes
    const cases: Array<{ record: Json; path: PropertyKey[] }> = [
      { record: makeRecord({ reproducer: { signature_hash: "a".repeat(63) } }), path: ["reproducer", "signature_hash"] },
      { record: makeRecord({ reproducer: { signature_hash: "a".repeat(65) } }), path: ["reproducer", "signature_hash"] },
      { record: makeRecord({ reproducer: { signature_hash: "A".repeat(64) } }), path: ["reproducer", "signature_hash"] },
      {
        record: makeRecord({ patch: { files: [{ path: "src/slice.ts", before_sha256: "a".repeat(63), after_sha256: sha("c") }] } }),
        path: ["patch", "files", 0, "before_sha256"],
      },
      { record: makeRecord({ patch: { commit_sha: "abcdef" } }), path: ["patch", "commit_sha"] },
      { record: makeRecord({ patch: { commit_sha: "ABCDEF1" } }), path: ["patch", "commit_sha"] },
      {
        record: makeRecord({ regression_test: { path: "tests/src/slice.test.ts", pristine_failure_signature: "short" } }),
        path: ["regression_test", "pristine_failure_signature"],
      },
    ]

    //#when/then - each fails on the offending field
    for (const { record, path } of cases) {
      expectPath(failingIssues(record), path)
    }
  })

  test("rejects an unknown status, a wrong literal, and an invalid run id", () => {
    //#given - unsupported status, allow_exec false, and a bad run id
    const cases: Array<{ record: Json; path: PropertyKey[] }> = [
      { record: makeRecord({ status: "fixed" }), path: ["status"] },
      { record: makeRecord({ options: { allow_exec: false } }), path: ["options", "allow_exec"] },
      { record: makeRecord({ sandbox: "container" }), path: ["sandbox"] },
      { record: makeRecord({ schema_version: 2 }), path: ["schema_version"] },
      { record: makeRecord({ run: "../run-1" }), path: ["run"] },
      { record: makeRecord({ terminal_reason: "" }), path: ["terminal_reason"] },
      { record: makeRecord({ finding: { tier: "E4" } }), path: ["finding", "tier"] },
    ]

    //#when/then - each fails on the offending field
    for (const { record, path } of cases) {
      expectPath(failingIssues(record), path)
    }
  })

  test("rejects unknown keys at the top level and in nested objects", () => {
    //#given - an extra top-level key and an extra option key
    const topLevel = makeRecord({ unexpected: true })
    const nested = makeRecord({ options: { extra_flag: true } })

    //#when/then - strict objects reject both
    expect(FixRecordSchema.safeParse(topLevel).success).toBe(false)
    expect(FixRecordSchema.safeParse(nested).success).toBe(false)
  })
})

describe("hardening regressions", () => {
  test("a path cannot masquerade as an option or a response-file directive", () => {
    //#given - three paths that a CLI could read as a flag or an @file directive
    const hostile = ["-rf", "@evil", "@/etc/passwd"]

    //#when/then - each is refused on the patch and reproducer fields
    for (const path of hostile) {
      const patchRecord = makeRecord({
        patch: {
          files: [{ path, before_sha256: sha("a"), after_sha256: sha("b") }],
          diff_path: "patches/fp.diff",
          changed_lines: 3,
          commit_sha: "abcdef1",
        },
      })
      expectPath(failingIssues(patchRecord), ["patch", "files", 0, "path"])

      const reproducerRecord = makeRecord()
      reproducerRecord.reproducer = { ...reproducerRecord.reproducer!, path } as never
      expectPath(failingIssues(reproducerRecord), ["reproducer", "path"])
    }
  })

  test("path fields refuse shell metacharacters, spaces and control characters", () => {
    //#given - patch paths that would break out of the documented shell invocations
    const hostile = ["src/a;b.ts", "src/a b.ts", "src/a$(id).ts", "src/a>b.ts", "src/a|b.ts", "src/a\nb.ts"]

    //#when/then - every one is refused on the patch path
    for (const path of hostile) {
      const record = makeRecord({
        patch: {
          files: [{ path, before_sha256: sha("b"), after_sha256: sha("c") }],
          diff_path: "patches/fp.diff",
          changed_lines: 3,
          commit_sha: "abcdef1",
        },
      })
      expectPath(failingIssues(record), ["patch", "files", 0, "path"])
    }
  })

  test("a reproducer path cannot carry shell metacharacters", () => {
    //#given - a reproducer whose filename would break the test invocation
    const record = makeRecord()
    ;(record.reproducer as Record<string, unknown>).path = "reproducers/a;b.test.ts"

    //#when/then - the confinement rule refuses it
    expectPath(failingIssues(record), ["reproducer", "path"])
  })

  test("drive-relative and nested reserved segments are refused", () => {
    //#given - a colon path and a nested .matrixx directory
    const driveRelative = makeRecord({
      patch: {
        files: [{ path: "C:x", before_sha256: sha("b"), after_sha256: sha("c") }],
        diff_path: "patches/fp.diff",
        changed_lines: 3,
        commit_sha: "abcdef1",
      },
    })
    const nestedReserved = makeRecord({
      patch: {
        files: [{ path: "src/.matrixx/x", before_sha256: sha("b"), after_sha256: sha("c") }],
        diff_path: "patches/fp.diff",
        changed_lines: 3,
        commit_sha: "abcdef1",
      },
    })

    //#when/then - both are refused at the patch path
    expectPath(failingIssues(driveRelative), ["patch", "files", 0, "path"])
    expectPath(failingIssues(nestedReserved), ["patch", "files", 0, "path"])
  })

  test("an abandoned record cannot carry execution artefacts", () => {
    //#given - three abandoned records that each smuggle a completed run
    const withVerification = makeRecordWithEmptyGates({
      status: "abandoned",
      independent_verification: {
        verifier: "merovingian",
        status: "pass",
        clean_checkout: true,
        detail: "looked fine",
      },
      terminal_reason: "operator abort",
    })
    const withPatch = makeRecordWithEmptyGates({
      status: "abandoned",
      patch: {
        files: [{ path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") }],
        diff_path: "patches/fp.diff",
        changed_lines: 4,
        commit_sha: "abcdef1",
      },
      terminal_reason: "operator abort",
    })
    const withAttempts = makeRecordWithEmptyGates({
      status: "abandoned",
      attempts: 2,
      terminal_reason: "operator abort",
    })

    //#when/then - each is refused on its own path
    expectPath(failingIssues(withVerification), ["independent_verification"])
    expectPath(failingIssues(withPatch), ["patch"])
    expectPath(failingIssues(withAttempts), ["attempts"])
  })

  test("an abandoned record cannot carry post-patch runs", () => {
    //#given - an abandoned record whose reproducer claims patched attempts
    const record = makeRecordWithEmptyGates({
      status: "abandoned",
      ineligible: { reason: "ineligible: tier E1 (requires E2/E3)" },
      reproducer: {
        path: "reproducers/slice.test.ts",
        signature_hash: sha("a"),
        pristine_runs: [{ attempt: 1, exit_code: 1, signature_hash: sha("a") }],
        pristine_failures: 1,
        deterministic: false,
        patched_passes: 3,
      },
      terminal_reason: "ineligible: tier E1",
    })

    //#when/then - the abandonment is contradicted by post-patch evidence
    expectPath(failingIssues(record), ["reproducer"])
  })

  test("only abandoned records may omit the finding severity", () => {
    //#given - a plausible record stripped of its finding severity
    const record = makeRecord({ finding: { severity: undefined } })

    //#when/then - the severity is required for any non-abandoned record
    expectPath(failingIssues(record), ["finding", "severity"])
  })

  test("an unreproducible record cannot carry gate results", () => {
    //#given - an unreproducible record that also claims two passing gates
    const record = makeRecord({ status: "unreproducible", terminal_reason: "pristine reproduction diverged" })
    record.gates = {
      G1: { status: "pass", detail: "manifest unchanged" },
      G3: { status: "pass", detail: "suite green" },
    }

    //#when/then - gates are refused outright for this status
    expectPath(failingIssues(record), ["gates"])
  })

  test("an unreproducible record cannot carry post-patch runs", () => {
    //#given - an unreproducible record whose reproducer claims passing patched runs
    const record = makeRecord({
      status: "unreproducible",
      reproducer: {
        path: "reproducers/slice.test.ts",
        signature_hash: sha("a"),
        pristine_runs: [{ attempt: 1, exit_code: 1, signature_hash: sha("a") }],
        pristine_failures: 1,
        deterministic: false,
        patched_passes: 3,
        patched_runs: [
          { attempt: 1, exit_code: 0 },
          { attempt: 2, exit_code: 0 },
          { attempt: 3, exit_code: 0 },
        ],
      },
      patch: undefined,
    })

    //#when/then - no patch was attempted, so post-patch evidence is contradictory
    expectPath(failingIssues(record), ["reproducer"])
  })

  test("only abandoned records may rest on an ineligible tier", () => {
    //#given - a rejected record for an E1 finding and an E0 unreproducible record
    //#when - both are parsed
    //#then - each is refused on the tier path
    expectPath(
      failingIssues(makeRecordWithEmptyGates({ status: "rejected", finding: { tier: "E1" } })),
      ["finding", "tier"],
    )
    expectPath(
      failingIssues(
        makeRecordWithEmptyGates({
          status: "unreproducible",
          finding: { tier: "E0" },
        }),
      ),
      ["finding", "tier"],
    )
  })

  test("G5 must be omitted when --mutation was not passed", () => {
    //#given - a passing mutation gate on a run that never asked for mutation testing
    const record = makeRecord({
      gates: passingGates({ G5: { status: "pass", detail: "mutation score held" } }),
    })

    //#when/then - the flag rule refuses the record
    expectPath(failingIssues(record), ["gates", "G5"])
  })

  test("reserved patch roots are matched case-insensitively", () => {
    //#given - case variants of .git that resolve to it on macOS and Windows
    const record = makeRecord({
      patch: {
        files: [
          { path: ".GIT/config", before_sha256: sha("b"), after_sha256: sha("c") },
        ],
      },
    })

    //#when/then - the reserved-root rule still refuses the patch
    expectPath(failingIssues(record), ["patch", "files", 0, "path"])
  })

  test("normalized tests/ spellings cannot smuggle a second test path", () => {
    //#given - a patch carrying a ./tests/ path with no regression test recorded
    const cases = [
      makeRecord({ patch: { files: [{ path: "./tests/src/evil.test.ts", before_sha256: null, after_sha256: sha("d") }] } }),
      makeRecord({ patch: { files: [{ path: "src/../tests/evil.test.ts", before_sha256: null, after_sha256: sha("d") }] } }),
    ]

    //#when/then - every spelling is rejected somewhere under patch.files
    for (const record of cases) {
      const issues = failingIssues(record)
      expect(issues.some((issue) => issue.path[0] === "patch" && issue.path[1] === "files")).toBe(true)
    }
  })

  test("a disguised second test path breaks the exactly-one rule", () => {
    //#given - the recorded regression test plus a ./tests/ alias
    const record = makeRecord({
      regression_test: {
        path: "tests/src/slice.test.ts",
        failed_on_pristine: true,
        before_absent: true,
        pristine_failure_signature: sha("a"),
        evidence_path: "evidence/slice.log",
        diff_path: "patches/slice.diff",
      },
      patch: {
        files: [
          { path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") },
          { path: "tests/src/slice.test.ts", before_sha256: null, after_sha256: sha("d") },
          { path: "./tests/src/other.test.ts", before_sha256: null, after_sha256: sha("e") },
        ],
      },
    })

    //#when/then - rejected because a second tests/ path is present
    const issues = failingIssues(record)
    expect(issues.some((issue) => issue.path[0] === "patch" && issue.path[1] === "files")).toBe(true)
  })

  test("the regression test must be absent before the patch", () => {
    //#given - a regression test file with a pre-patch hash
    const record = makeRecord({
      regression_test: {
        path: "tests/src/slice.test.ts",
        failed_on_pristine: true,
        before_absent: true,
        pristine_failure_signature: sha("a"),
        evidence_path: "evidence/slice.log",
        diff_path: "patches/slice.diff",
      },
      patch: {
        files: [
          { path: "src/slice.ts", before_sha256: sha("b"), after_sha256: sha("c") },
          { path: "tests/src/slice.test.ts", before_sha256: sha("d"), after_sha256: sha("e") },
        ],
      },
    })

    //#when/then - rejected
    expectPath(failingIssues(record), ["regression_test", "before_absent"])
  })

  test("attempts cannot exceed the configured budget", () => {
    //#given - a record claiming more attempts than max_attempts
    const record = makeRecord({ attempts: 9 })

    //#when/then - rejected
    expectPath(failingIssues(record), ["attempts"])
  })

  test("max_attempts is bounded to the documented 1..5 range", () => {
    //#given - an out-of-range budget
    const record = makeRecord({ options: { max_attempts: 9 } })

    //#when/then - rejected at the option itself
    expectPath(failingIssues(record), ["options", "max_attempts"])
  })

  test("pristine evidence must match the recorded failure signature", () => {
    //#given - three pristine runs with two different signatures
    const record = makeRecord({
      reproducer: {
        pristine_runs: [
          { attempt: 1, exit_code: 1, signature_hash: sha("a") },
          { attempt: 2, exit_code: 1, signature_hash: sha("f") },
          { attempt: 3, exit_code: 1, signature_hash: sha("a") },
        ],
      },
    })

    //#when/then - the drifting run is rejected
    expectPath(failingIssues(record), ["reproducer", "pristine_runs", 1, "signature_hash"])
  })

  test("pristine_failures must equal the number of recorded runs", () => {
    //#given - a claim of three failures backed by one run
    const record = makeRecord({
      reproducer: {
        pristine_runs: [{ attempt: 1, exit_code: 1, signature_hash: sha("a") }],
      },
    })

    //#when/then - rejected
    expectPath(failingIssues(record), ["reproducer", "pristine_failures"])
  })

  test("the post-patch runs must be recorded and pass", () => {
    //#given - a claim of three passes with no runs
    const missing = makeRecord({ reproducer: { patched_runs: undefined } })
    //#and - a recorded run that fails
    const failing = makeRecord({
      reproducer: { patched_runs: [{ attempt: 1, exit_code: 0 }, { attempt: 2, exit_code: 1 }, { attempt: 3, exit_code: 0 }] },
    })

    //#when/then - both are rejected
    expectPath(failingIssues(missing), ["reproducer", "patched_runs"])
    expectPath(failingIssues(failing), ["reproducer", "patched_runs", 1, "exit_code"])
  })

  test("G5 may only be blocked or skipped when --mutation was passed", () => {
    //#given - a blocked mutation gate without the flag
    const record = makeRecord({
      gates: passingGates({ G5: { status: "blocked", detail: "stryker missing", install_hint: "bun add -d @stryker-mutator/core" } }),
    })

    //#when/then - rejected
    expectPath(failingIssues(record), ["gates", "G5"])
  })

  test("a finding below --min-severity is refused", () => {
    //#given - a low severity finding with a medium threshold
    const record = makeRecord({ finding: { severity: "low" } })

    //#when/then - rejected
    expectPath(failingIssues(record), ["finding", "severity"])
  })

  test("independent verification must use a clean checkout", () => {
    //#given - a passing verifier on a dirty checkout
    const record = makeRecord({ independent_verification: { clean_checkout: false } })

    //#when/then - rejected
    expectPath(failingIssues(record), ["independent_verification", "clean_checkout"])
  })

  test("a backslash spelling cannot masquerade as a tests/ path", () => {
    //#given - a regression test path using a Windows separator, plus a root-level file
    const record = makeRecord({
      regression_test: {
        path: "tests\\src\\slice.test.ts",
        failed_on_pristine: true,
        before_absent: true,
        pristine_failure_signature: sha("a"),
        evidence_path: "evidence/slice.log",
        diff_path: "patches/slice.diff",
      },
    })

    //#when - the record is validated
    const issues = failingIssues(record)

    //#then - the separator itself is refused on the regression test path
    expectPath(issues, ["regression_test", "path"])
  })

  test("a patch may not target .matrixx or .git paths", () => {
    //#given - a patch that rewrites the run reproducer and one that edits git metadata
    const cases = [
      makeRecord({ patch: { files: [{ path: ".matrixx/bugs/run-1/reproducers/x.test.ts", before_sha256: sha("b"), after_sha256: sha("c") }] } }),
      makeRecord({ patch: { files: [{ path: "src/.git/hooks/pre-commit", before_sha256: sha("b"), after_sha256: sha("c") }] } }),
    ]

    //#when/then - both are refused on the offending file entry
    for (const record of cases) {
      const issues = failingIssues(record)
      expectPath(issues, ["patch", "files", 0, "path"])
    }
  })

  test("every resolution-flavoured word is refused as a status", () => {
    //#given - the words an over-eager writer might use instead of the four statuses
    const words = ["fixed", "correct", "verified", "patched", "resolved", "wontfix", "reproducible"]

    //#when/then - each is refused on the status path
    for (const word of words) {
      const issues = failingIssues(makeRecord({ status: word }))
      expectPath(issues, ["status"])
    }
  })

  test("fewer than three pristine failures cannot be plausible", () => {
    //#given - two failing runs with matching counts, so only the <3 rule can reject
    const record = makeRecord({
      reproducer: {
        path: "reproducers/slice.test.ts",
        signature_hash: sha("a"),
        pristine_runs: [
          { attempt: 1, exit_code: 1, signature_hash: sha("a") },
          { attempt: 2, exit_code: 1, signature_hash: sha("a") },
        ],
        pristine_failures: 2,
        deterministic: true,
        patched_passes: 3,
        patched_runs: [
          { attempt: 1, exit_code: 0 },
          { attempt: 2, exit_code: 0 },
          { attempt: 3, exit_code: 0 },
        ],
      },
    })

    //#when - validated
    const issues = failingIssues(record)

    //#then - the failure count is the reason
    expectPath(issues, ["reproducer", "pristine_failures"])
  })

  test("the status enum is closed", () => {
    //#given - an invented status word
    for (const status of ["reproducible", "resolved", "wontfix"]) {
      //#when/then - rejected
      expectPath(failingIssues(makeRecord({ status })), ["status"])
    }
  })
})
