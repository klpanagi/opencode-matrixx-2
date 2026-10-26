import { describe, expect, test } from "bun:test"
import {
  FindingSchema,
  LedgerSchema,
} from "../../src/skills/schemas/security-audit"

const validEvidence = {
  root_cause: "unsanitized input flows to query sink",
  execution: "send payload X as user Y, observe Z",
  remediation: "parameterize query at src/db.ts",
}

const validLocation = { path: "src/db.ts", lines: [42] }

describe("FindingSchema", () => {
  test("valid confirmed finding passes", () => {
    //#given - a fully-populated confirmed finding
    const finding = {
      fingerprint: "auth/sql-injection@src/db.ts:42",
      status: "confirmed",
      title: "SQL injection in login",
      description: "unsanitized input reaches query",
      severity: "critical",
      cwe: "CWE-89",
      location: validLocation,
      evidence: validEvidence,
    }

    //#when - parsed
    const result = FindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("needs_validation WITH severity fails", () => {
    //#given - unvalidated candidate carrying a severity anchor
    const finding = {
      fingerprint: "auth/xss@src/view.ts:7",
      status: "needs_validation",
      title: "possible XSS",
      description: "reflected value may reach sink",
      severity: "high",
      location: validLocation,
      evidence: validEvidence,
    }

    //#when - parsed
    const result = FindingSchema.safeParse(finding)

    //#then - rejected by the severity refine
    expect(result.success).toBe(false)
  })

  test("needs_validation WITHOUT severity passes", () => {
    //#given - unvalidated candidate with no severity
    const finding = {
      fingerprint: "auth/xss@src/view.ts:7",
      status: "needs_validation",
      title: "possible XSS",
      description: "reflected value may reach sink",
      location: validLocation,
      evidence: validEvidence,
    }

    //#when - parsed
    const result = FindingSchema.safeParse(finding)

    //#then - accepted
    expect(result.success).toBe(true)
  })

  test("unknown status fails", () => {
    //#given - a finding with a non-enum status
    const finding = {
      fingerprint: "auth/csrf@src/form.ts:3",
      status: "maybe",
      title: "possible CSRF",
      description: "missing token",
      location: validLocation,
      evidence: validEvidence,
    }

    //#when - parsed
    const result = FindingSchema.safeParse(finding)

    //#then - rejected
    expect(result.success).toBe(false)
  })

  test("bad fingerprint fails", () => {
    //#given - fingerprint with leading space (violates vendored pattern)
    const finding = {
      fingerprint: " bad-fingerprint",
      status: "rejected",
      title: "refuted candidate",
      description: "could not reproduce",
      location: validLocation,
      evidence: validEvidence,
    }

    //#when - parsed
    const result = FindingSchema.safeParse(finding)

    //#then - rejected
    expect(result.success).toBe(false)
  })
})

describe("LedgerSchema", () => {
  test("ledger roundtrip", () => {
    //#given - a ledger with two units
    const ledger = {
      units: [
        { coverage_id: "surface/auth", status: "covered" },
        { coverage_id: "surface/api", status: "deferred" },
      ],
      status: "incomplete",
    }

    //#when - parsed and re-serialized
    const parsed = LedgerSchema.safeParse(ledger)

    //#then - accepted and JSON roundtrips identically
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(JSON.parse(JSON.stringify(parsed.data))).toEqual(ledger)
    }
  })

  test("unknown unit status fails", () => {
    //#given - ledger with a non-enum unit status
    const ledger = {
      units: [{ coverage_id: "surface/auth", status: "done-ish" }],
      status: "complete",
    }

    //#when - parsed
    const result = LedgerSchema.safeParse(ledger)

    //#then - rejected
    expect(result.success).toBe(false)
  })
})
