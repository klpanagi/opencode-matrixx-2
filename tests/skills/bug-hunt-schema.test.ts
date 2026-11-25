import { describe, expect, test } from "bun:test"
import {
  BugFindingSchema,
  BugFindingsSchema,
  BugLedgerUnitSchema,
  BugRunMetadataSchema,
} from "../../src/skills/loader/schemas/bug-hunt"

const validEvidence = {
  oracle: "bun test tests/slice.test.ts",
  witness: "expected [1,2], received [1]",
  root_cause: "exclusive upper bound drops the final element",
  remediation: "use an inclusive bound at src/slice.ts",
}

const validLocation = { path: "src/slice.ts", lines: [12] }

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprint: "src/slice.ts:off-by-one",
    bug_class: "algorithms",
    tier: "E3",
    status: "confirmed",
    stage: "S4",
    title: "off-by-one drops the last element",
    description: "slice bound excludes the final element",
    severity: "high",
    location: validLocation,
    evidence: validEvidence,
    ...overrides,
  }
}

interface IssueLike {
  message: string
  path: PropertyKey[]
}

/** Asserts the parse failed and returns its issues for message/path assertions. */
function failureIssues(result: { success: boolean; error?: { issues: IssueLike[] } }): IssueLike[] {
  expect(result.success).toBe(false)
  return result.error?.issues ?? []
}

function expectIssue(issues: IssueLike[], text: string): void {
  expect(issues.some((issue) => issue.message.includes(text))).toBe(true)
}

describe("BugFindingSchema", () => {
  test("E0 with a severity fails", () => {
    //#given - a candidate-tier finding that carries a severity
    const finding = makeFinding({ tier: "E0", status: "needs_validation", severity: "low" })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected for the E0 severity rule, on the severity field
    expectIssue(issues, "E0 findings must not carry a severity")
    expect(issues.some((issue) => issue.path[0] === "severity")).toBe(true)
  })

  test("E0 with confirmed status fails", () => {
    //#given - an E0 finding marked confirmed, no severity
    const finding = makeFinding({ tier: "E0", status: "confirmed", severity: undefined })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: E0 must stay needs_validation
    expectIssue(issues, "E0 findings must have status needs_validation")
    expect(issues.some((issue) => issue.path[0] === "status")).toBe(true)
  })

  test("E0 needs_validation without severity passes", () => {
    //#given - a well-formed candidate (E0, unvalidated, no severity)
    const finding = makeFinding({ tier: "E0", status: "needs_validation", severity: undefined })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("E1 with high severity fails", () => {
    //#given - a witnessed finding above the E1 ceiling
    const finding = makeFinding({ tier: "E1", severity: "high" })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: E1 is capped at medium
    expectIssue(issues, "E1 findings are capped at medium severity")
  })

  test("E1 with medium severity passes", () => {
    //#given - a witnessed finding at the E1 ceiling
    const finding = makeFinding({ tier: "E1", severity: "medium" })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("E1 without severity passes", () => {
    //#given - a witnessed finding with no severity assigned
    const finding = makeFinding({ tier: "E1", severity: undefined })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("E2 critical with reproducer passes", () => {
    //#given - a reproduced finding pointing at a minimized reproducer
    const finding = makeFinding({
      tier: "E2",
      severity: "critical",
      reproducer: "reproducers/slice-off-by-one.test.ts",
    })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("E2 without reproducer fails", () => {
    //#given - a reproduced finding with no reproducer artifact
    const finding = makeFinding({ tier: "E2", severity: "critical" })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: E2 requires a reproducer
    expectIssue(issues, "E2 findings must reference a reproducer under reproducers/")
    expect(issues.some((issue) => issue.path[0] === "reproducer")).toBe(true)
  })

  test("E3 critical passes", () => {
    //#given - a fully proven finding (E3) with critical severity
    const finding = makeFinding({ tier: "E3", severity: "critical" })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted: E3 severity is free
    expect(result.success).toBe(true)
  })

  test("E3 without reproducer passes", () => {
    //#given - a proven finding with no reproducer artifact (only E2 requires one)
    const finding = makeFinding({ tier: "E3", severity: "critical", reproducer: undefined })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted: only E2 requires a reproducer
    expect(result.success).toBe(true)
  })

  test("reproducer traversal segment fails", () => {
    //#given - an E2 finding whose reproducer escapes the reproducers dir
    const finding = makeFinding({ tier: "E2", severity: "high", reproducer: "../x" })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected by the confinement rule
    expectIssue(issues, "reproducer must be a relative path under reproducers/")
    expect(issues.some((issue) => issue.path[0] === "reproducer")).toBe(true)
  })

  test("absolute reproducer path fails", () => {
    //#given - an E2 finding pointing at an absolute path outside the project
    const finding = makeFinding({ tier: "E2", severity: "high", reproducer: "/etc/passwd" })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: reproducers are relative and confined
    expectIssue(issues, "reproducer must be a relative path under reproducers/")
  })

  test("reproducer outside reproducers/ fails", () => {
    //#given - an E2 finding whose reproducer lives outside the reproducers dir
    const finding = makeFinding({
      tier: "E2",
      severity: "high",
      reproducer: "totally/not/reproducers/x.txt",
    })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: the normalized path must start with reproducers/
    expectIssue(issues, "reproducer must be a relative path under reproducers/")
  })

  test("location.path traversal segment fails", () => {
    //#given - a finding whose location escapes the project
    const finding = makeFinding({ location: { path: "../x", lines: [1] } })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected on the nested location.path field
    expectIssue(issues, "location.path must be a relative project path")
    expect(issues.some((issue) => issue.path[0] === "location" && issue.path[1] === "path")).toBe(true)
  })

  test("absolute location.path fails", () => {
    //#given - a finding whose location is an absolute path
    const finding = makeFinding({ location: { path: "/abs", lines: [1] } })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: project locations are relative
    expectIssue(issues, "location.path must be a relative project path")
  })

  test("location.path with NUL or percent-encoded separators fails", () => {
    //#given - location paths carrying encoded separators or a NUL byte
    const paths = ["src/\u0000/a.ts", "src%2f..%2f..%2fetc", "a%5c..%5cb"]

    //#when/then - each is rejected on the nested location.path field
    for (const path of paths) {
      const finding = makeFinding({ location: { path, lines: [1] } })
      const issues = failureIssues(BugFindingSchema.safeParse(finding))
      expectIssue(issues, "location.path must be a relative project path")
      expect(issues.some((issue) => issue.path[0] === "location" && issue.path[1] === "path")).toBe(true)
    }
  })

  test("needs_validation above E0 fails", () => {
    //#given - a witnessed finding that is still marked unvalidated
    const finding = makeFinding({ tier: "E1", status: "needs_validation", severity: undefined })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - rejected: needs_validation requires E0
    expectIssue(issues, "needs_validation requires tier E0")
    expect(issues.some((issue) => issue.path[0] === "tier")).toBe(true)
  })

  test("E2 needs_validation fails even with a reproducer", () => {
    //#given - a reproduced finding that is still marked unvalidated
    const finding = makeFinding({
      tier: "E2",
      status: "needs_validation",
      reproducer: "reproducers/slice-off-by-one.test.ts",
    })

    //#when - parsed
    const issues = failureIssues(BugFindingSchema.safeParse(finding))

    //#then - one mistake, one issue: only the E0 requirement fires
    expect(issues).toHaveLength(1)
    expectIssue(issues, "needs_validation requires tier E0")
    expect(issues.some((issue) => issue.message.includes("E2/E3 findings are validated"))).toBe(false)
  })

  test("unknown extra key fails (strict)", () => {
    //#given - a valid finding polluted with an off-contract key
    const finding = { ...makeFinding(), extra: 1 }

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - rejected by the strict object
    expect(result.success).toBe(false)
  })

  test("bad bug_class fails", () => {
    //#given - a finding outside the ODC taxonomy
    const finding = makeFinding({ bug_class: "vibes" })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - rejected
    expect(result.success).toBe(false)
  })

  test("bare numeric cwe fails", () => {
    //#given - a CWE reference missing the CWE- prefix
    const finding = makeFinding({ cwe: "79" })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - rejected
    expect(result.success).toBe(false)
  })

  test("prefixed cwe passes", () => {
    //#given - a properly prefixed CWE reference
    const finding = makeFinding({ cwe: "CWE-79" })

    //#when - parsed
    const result = BugFindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })
})

describe("BugFindingsSchema", () => {
  test("array of valid findings passes", () => {
    //#given - two valid findings
    const findings = [makeFinding(), makeFinding({ fingerprint: "src/slice.ts:second" })]

    //#when - parsed as an array
    const result = BugFindingsSchema.safeParse(findings)

    //#then - accepted
    expect(result.success).toBe(true)
  })
})

describe("BugLedgerUnitSchema", () => {
  test("blocked unit without install_hint fails", () => {
    //#given - a blocked coverage unit with no remediation hint
    const unit = { coverage_id: "surface/python", status: "blocked" }

    //#when - parsed
    const issues = failureIssues(BugLedgerUnitSchema.safeParse(unit))

    //#then - rejected: blocked units must say how to unblock
    expectIssue(issues, "blocked units must carry an install hint")
    expect(issues.some((issue) => issue.path[0] === "install_hint")).toBe(true)
  })

  test("blocked unit with install_hint passes", () => {
    //#given - a blocked unit carrying an install hint
    const unit = {
      coverage_id: "surface/python",
      status: "blocked",
      install_hint: "pip install pytest",
    }

    //#when - parsed
    const result = BugLedgerUnitSchema.safeParse(unit)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("non-blocked unit with install_hint fails", () => {
    //#given - a covered unit carrying a hint that only blocked units may have
    const unit = {
      coverage_id: "surface/python",
      status: "covered",
      install_hint: "pip install pytest",
    }

    //#when - parsed
    const issues = failureIssues(BugLedgerUnitSchema.safeParse(unit))

    //#then - rejected: hints belong to blocked units only
    expectIssue(issues, "install_hint is only allowed on blocked units")
    expect(issues.some((issue) => issue.path[0] === "install_hint")).toBe(true)
  })
})

describe("BugRunMetadataSchema", () => {
  function makeMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      run: "run-1",
      startedAt: "2026-11-25T00:00:00Z",
      scope: "module",
      depth: "static",
      class_filter: "all",
      funded: true,
      status: "complete",
      ...overrides,
    }
  }

  test("run-0 fails", () => {
    //#given - a zero run id (run numbering starts at 1)
    const metadata = makeMetadata({ run: "run-0" })

    //#when - parsed
    const result = BugRunMetadataSchema.safeParse(metadata)

    //#then - rejected
    expect(result.success).toBe(false)
  })

  test("run-12 passes", () => {
    //#given - a multi-digit run id
    const metadata = makeMetadata({ run: "run-12" })

    //#when - parsed
    const result = BugRunMetadataSchema.safeParse(metadata)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("class_filter outside the ODC taxonomy fails", () => {
    //#given - an invented class filter
    const metadata = makeMetadata({ class_filter: "vibes" })

    //#when - parsed
    const result = BugRunMetadataSchema.safeParse(metadata)

    //#then - rejected: only ODC classes, cwe-N, or all are allowed
    expect(result.success).toBe(false)
  })

  test("class_filter accepts an ODC class, all, and cwe-N", () => {
    //#given - each documented --class form
    const filters = ["checking", "all", "cwe-79"]

    //#when/then - each parses
    for (const classFilter of filters) {
      expect(BugRunMetadataSchema.safeParse(makeMetadata({ class_filter: classFilter })).success).toBe(true)
    }
  })

  test("target traversal and absolute paths fail on the target field", () => {
    //#given - metadata targeting outside the project
    const targets = ["../outside", "/abs/path"]

    //#when/then - each is rejected on the target field
    for (const target of targets) {
      const result = BugRunMetadataSchema.safeParse(makeMetadata({ target }))
      const issues = failureIssues(result)
      expectIssue(issues, "target must be a project-relative path with no '..' segment or absolute path")
      expect(issues.some((issue) => issue.path[0] === "target")).toBe(true)
    }
  })

  test("confined target passes", () => {
    //#given - a project-relative target
    //#when/then - it parses
    expect(BugRunMetadataSchema.safeParse(makeMetadata({ target: "src/features/x.ts" })).success).toBe(true)
  })

  test("derived counts field is rejected (strict)", () => {
    //#given - metadata carrying a derived counts block
    const metadata = makeMetadata({ counts: { E0: 1, E1: 0, E2: 0, E3: 0 } })

    //#when - parsed
    const result = BugRunMetadataSchema.safeParse(metadata)

    //#then - rejected: counts come from findings, not metadata
    expect(result.success).toBe(false)
  })
})
