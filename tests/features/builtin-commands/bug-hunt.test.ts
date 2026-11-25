import { describe, expect, test } from "bun:test"
import { BUILTIN_COMMAND_DEFINITIONS } from "../../../src/features/builtin-commands/commands"
import { buildBuiltinCommandEntries } from "../../../src/features/builtin-commands/commands.transform"
import { BUG_HUNT_TEMPLATE } from "../../../src/features/builtin-commands/templates/bug-hunt"

describe("bug-hunt template", () => {
  test("should render usage with every documented flag", () => {
    //#given the usage line documents the full flag surface
    //#when we read the template
    //#then all six flags are present
    expect(BUG_HUNT_TEMPLATE).toContain("/bug-hunt")
    expect(BUG_HUNT_TEMPLATE).toContain("--scope=file|module|project")
    expect(BUG_HUNT_TEMPLATE).toContain("--target=<path>")
    expect(BUG_HUNT_TEMPLATE).toContain("--class=")
    expect(BUG_HUNT_TEMPLATE).toContain("--depth=static|dynamic|deep")
    expect(BUG_HUNT_TEMPLATE).toContain("--budget=N")
    expect(BUG_HUNT_TEMPLATE).toContain("--verify=<run-N>")
    expect(BUG_HUNT_TEMPLATE).toContain('"cwe": "CWE-79"')
  })

  test("should document the four evidence tiers and the candidate status", () => {
    //#given the evidence ladder is the core contract
    //#when we read the template
    //#then every tier and needs_validation are named
    expect(BUG_HUNT_TEMPLATE).toContain("E3")
    expect(BUG_HUNT_TEMPLATE).toContain("E2")
    expect(BUG_HUNT_TEMPLATE).toContain("E1")
    expect(BUG_HUNT_TEMPLATE).toContain("E0")
    expect(BUG_HUNT_TEMPLATE).toContain("needs_validation")
  })

  test("should walk all ten stages in order", () => {
    //#given the EGDD method is a ten-stage pipeline
    //#when we read the ordered steps
    //#then S0 through S9 appear in ascending order
    const markers = [
      "**S0 Frame.**",
      "**S1 Invariant mining.**",
      "**S2 Static semantic analysis.**",
      "**S3 Contract and property synthesis.**",
      "**S4 Bounded verification.**",
      "**S5 Directed fuzzing and sanitizers.**",
      "**S6 LLM hypothesis generation.**",
      "**S7 Reduction and root cause.**",
      "**S8 Fault localization.**",
      "**S9 Adversarial validation.**",
    ]
    let previous = -1
    for (const marker of markers) {
      const index = BUG_HUNT_TEMPLATE.indexOf(marker)
      expect(index).toBeGreaterThan(previous)
      previous = index
    }
  })

  test("should document exit codes 0 clean, 1 findings, 2 invalid usage", () => {
    //#given the exit-code contract 0/1/2
    //#when we read the template
    //#then all three codes and a bogus-flag example are documented
    expect(BUG_HUNT_TEMPLATE).toContain("0 clean")
    expect(BUG_HUNT_TEMPLATE).toContain("1 findings")
    expect(BUG_HUNT_TEMPLATE).toContain("2 invalid usage")
    expect(BUG_HUNT_TEMPLATE).toContain("--scope=bogus")
    expect(BUG_HUNT_TEMPLATE).toContain("exit 2")
  })

  test("should be read-only and write only under .matrixx/bugs/<run-N>/", () => {
    //#given the hunt never mutates source
    //#when we read the forbid list
    //#then read-only is stated and the bugs output dir is the only write target
    expect(BUG_HUNT_TEMPLATE).toContain("read-only")
    expect(BUG_HUNT_TEMPLATE).toContain(".matrixx/bugs/<run-N>/")
    expect(BUG_HUNT_TEMPLATE).toContain("run-metadata.json")
    expect(BUG_HUNT_TEMPLATE).toContain("coverage-ledger.json")
    expect(BUG_HUNT_TEMPLATE).toContain("findings.json")
    expect(BUG_HUNT_TEMPLATE).toContain("reproducers/")
    expect(BUG_HUNT_TEMPLATE).toContain("NO network probes")
    expect(BUG_HUNT_TEMPLATE).toContain("NO git state changes")
    expect(BUG_HUNT_TEMPLATE).toContain(".matrixx/bugs/<run-N>/reproducers/")
    expect(BUG_HUNT_TEMPLATE).toContain("TARGET SAFETY")
  })

  test("should forbid publishing and dependency installation", () => {
    //#given the forbid list names dependency actions as well as git state changes
    //#when we read the template
    //#then publishing and installs are explicitly denied
    expect(BUG_HUNT_TEMPLATE).toContain("NO publishing or installing dependencies")
    expect(BUG_HUNT_TEMPLATE).toContain("npm/bun/yarn publish")
  })

  test("should route work to the named agents", () => {
    //#given the stage-to-agent roster
    //#when we read the template
    //#then oracle, trinity, merovingian, mouse-source, and sentinel are named
    for (const agent of ["oracle", "trinity", "merovingian", "mouse-source", "sentinel"]) {
      expect(BUG_HUNT_TEMPLATE).toContain(agent)
    }
  })

  test("should preserve the user-request placeholder", () => {
    //#given the command wrapper contract
    //#when we read the template tail
    //#then the arguments placeholder is present
    expect(BUG_HUNT_TEMPLATE).toContain("<user-request>")
    expect(BUG_HUNT_TEMPLATE).toContain("$ARGUMENTS")
  })
})

describe("bug-hunt command registration", () => {
  test("should register bug-hunt in buildBuiltinCommandEntries", () => {
    //#given the builtin command registry
    //#when we load all builtin commands
    //#then bug-hunt is present with its argument hint
    const entries = buildBuiltinCommandEntries()
    expect(Object.keys(entries)).toContain("bug-hunt")
    expect(BUILTIN_COMMAND_DEFINITIONS["bug-hunt"].argumentHint).toContain("--depth")
  })

  test("should wrap the template in the command-instruction envelope", () => {
    //#given the registered bug-hunt definition
    //#when we read its template
    //#then it matches the security-audit wrapper shape
    const definition = BUILTIN_COMMAND_DEFINITIONS["bug-hunt"]
    expect(definition.template).toContain("<command-instruction>")
    expect(definition.template).toContain(BUG_HUNT_TEMPLATE)
    expect(definition.description).toContain("read-only")
  })
})
