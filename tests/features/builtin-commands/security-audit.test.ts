import { describe, expect, test } from "bun:test"
import { BUILTIN_COMMAND_DEFINITIONS } from "../../../src/features/builtin-commands/commands"
import { buildBuiltinCommandEntries } from "../../../src/features/builtin-commands/commands.transform"
import { SECURITY_AUDIT_TEMPLATE } from "../../../src/features/builtin-commands/templates/security-audit"

describe("security-audit template", () => {
  test("should export a non-empty template string", () => {
    //#given the security-audit template
    //#when we access the template
    //#then it should be a non-empty string
    expect(typeof SECURITY_AUDIT_TEMPLATE).toBe("string")
    expect(SECURITY_AUDIT_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("should render usage with scope, target, full, and budget flags", () => {
    //#given the usage line documents the full flag surface
    //#when we read the template
    //#then all four flags are present
    expect(SECURITY_AUDIT_TEMPLATE).toContain("/security-audit")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("--scope=file|module|project")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("--target")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("--full")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("--budget=N")
  })

  test("should default to scoped file audit with a scoped-default disclaimer", () => {
    //#given a bare invocation must not assume full-tree scope
    //#when we read the scope default
    //#then the default is file (scoped), not project
    expect(SECURITY_AUDIT_TEMPLATE).toContain("(default: file")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("Scoped-default disclaimer")
    expect(SECURITY_AUDIT_TEMPLATE).not.toContain("(default: project)")
  })

  test("should gate --full behind an opt-in cost warning with confirmation", () => {
    //#given a full-tree audit costs an order of magnitude more tokens
    //#when we read the --full section
    //#then cost warning and confirmation are required
    expect(SECURITY_AUDIT_TEMPLATE).toContain("COST WARNING")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("confirmation")
  })

  test("should gate unfundable findings behind the budget with incomplete run status", () => {
    //#given the budget gate leaves remainder findings deferred
    //#when we read the --budget section
    //#then incomplete run status is documented
    expect(SECURITY_AUDIT_TEMPLATE).toContain("deferred")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("incomplete")
  })

  test("should be read-only with no probes and write only audit report files", () => {
    //#given the audit must not mutate source or probe live targets
    //#when we read the forbid list
    //#then read-only rules and the audits output dir are stated
    expect(SECURITY_AUDIT_TEMPLATE).toContain("read-only")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("NO network probes")
    expect(SECURITY_AUDIT_TEMPLATE).toContain(".matrixx/audits/<run-N>/")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("findings.json")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("coverage-ledger.json")
  })

  test("should document exit codes 0 clean, 1 findings, 2 invalid usage", () => {
    //#given the exit-code contract 0/1/2
    //#when we read the template
    //#then all three codes and the bogus-scope example are documented
    expect(SECURITY_AUDIT_TEMPLATE).toContain("0 clean")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("1 findings")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("2 invalid usage")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("--scope=bogus")
    expect(SECURITY_AUDIT_TEMPLATE).toContain("exit 2")
  })
})

describe("security-audit command registration", () => {
  test("should register security-audit in buildBuiltinCommandEntries", () => {
    //#given the builtin command registry
    //#when we load all builtin commands
    //#then security-audit is present with its argument hint
    const entries = buildBuiltinCommandEntries()
    expect(Object.keys(entries)).toContain("security-audit")
    expect(BUILTIN_COMMAND_DEFINITIONS["security-audit"].argumentHint).toContain("--budget=N")
  })
})
