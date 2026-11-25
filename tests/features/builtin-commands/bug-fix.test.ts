import { describe, expect, test } from "bun:test"
import { BuiltinCommandNameSchema } from "../../../src/config/schema/commands"
import { BUILTIN_COMMAND_DEFINITIONS } from "../../../src/features/builtin-commands/commands"
import { buildBuiltinCommandEntries } from "../../../src/features/builtin-commands/commands.transform"
import { BUG_FIX_TEMPLATE } from "../../../src/features/builtin-commands/templates/bug-fix"

const BACKTICK = String.fromCharCode(96)

const STEP_MARKERS = [
  "**F0 Intake and flag resolution.**",
  "**F0b Eligibility gate.**",
  "**Worktree and branch setup.**",
  "**F1 Reproducer trust.**",
  "**F2 Localize.**",
  "**F3 Patch.**",
  "**F3b Static checks.**",
  "**F4a G1 test-integrity.**",
  "**F4b G2 reproducer flip.**",
  "**F4c G3 full suite + G4 coverage.**",
  "**F4d G5 mutation (optional).**",
  "**F5 Independent verification, then F6 Record and report.**",
]

const ARGUMENT_HINT =
  "<run-N> [--fix-budget=N] [--max-attempts=N] [--min-severity=<level>] [--mutation] [--allow-exec] [--verify]"

describe("bug-fix template", () => {
  test("commit messages stay neutral and the branch resets per fix", () => {
    //#given the F3 commit happens before F4 gates exist
    //#when we read the template
    //#then no gate outcome is claimed and the branch is reset to the base each fix
    expect(BUG_FIX_TEMPLATE).toContain("candidate patch for <fingerprint>")
    expect(BUG_FIX_TEMPLATE).toContain("Reset the branch to that base before each fix")
    expect(BUG_FIX_TEMPLATE).not.toContain("plausible patch (gates G1-G4)")
  })

  test("should render usage with every documented flag", () => {
    //#given the write-capable pipeline exposes six flags plus a positional run id
    //#when we read the template
    //#then the usage line and every flag token are present
    expect(BUG_FIX_TEMPLATE).toContain("/bug-fix <run-N>")
    expect(BUG_FIX_TEMPLATE).toContain("--fix-budget")
    expect(BUG_FIX_TEMPLATE).toContain("--max-attempts")
    expect(BUG_FIX_TEMPLATE).toContain("--min-severity")
    expect(BUG_FIX_TEMPLATE).toContain("--mutation")
    expect(BUG_FIX_TEMPLATE).toContain("--allow-exec")
    expect(BUG_FIX_TEMPLATE).toContain("--verify")
  })

  test("should document all six flag defaults in the flags table", () => {
    //#given every flag has an explicit default contract
    //#when we read the flags table
    //#then each default is stated verbatim
    expect(BUG_FIX_TEMPLATE).toContain("| --fix-budget | 5 |")
    expect(BUG_FIX_TEMPLATE).toContain("| --max-attempts | 3 |")
    expect(BUG_FIX_TEMPLATE).toContain("| --min-severity | medium |")
    expect(BUG_FIX_TEMPLATE).toContain("| --mutation | off |")
    expect(BUG_FIX_TEMPLATE).toContain("| --allow-exec | required |")
    expect(BUG_FIX_TEMPLATE).toContain("| --verify | off |")
    expect(BUG_FIX_TEMPLATE).toContain("^run-[1-9][0-9]*$")
  })

  test("should make --allow-exec a hard refusal that writes nothing", () => {
    //#given the pipeline executes reproducers
    //#when --allow-exec is absent
    //#then the exact refusal message and exit 2 with no writes are mandated
    expect(BUG_FIX_TEMPLATE).toContain("--allow-exec")
    expect(BUG_FIX_TEMPLATE).toContain(
      "error: --allow-exec is required (this command executes reproducers)",
    )
    expect(BUG_FIX_TEMPLATE).toContain("write nothing")
    expect(BUG_FIX_TEMPLATE).toContain("exit 2")
    expect(BUG_FIX_TEMPLATE).toContain("HARD GATE")
  })

  test("should document exit codes 0/1/2/3 with precedence", () => {
    //#given the four-way exit-code contract
    //#when we read the template
    //#then every code, a bogus-flag example, and the precedence order are stated
    expect(BUG_FIX_TEMPLATE).toContain("0 nothing plausible")
    expect(BUG_FIX_TEMPLATE).toContain("1 one-or-more plausible")
    expect(BUG_FIX_TEMPLATE).toContain("2 invalid usage")
    expect(BUG_FIX_TEMPLATE).toContain("3 all attempts rejected")
    expect(BUG_FIX_TEMPLATE).toContain("error: invalid flag")
    expect(BUG_FIX_TEMPLATE).toContain("Precedence: 2 > 1 > 3 > 0.")
  })

  test("should walk the twelve ordered steps in ascending order", () => {
    //#given the pipeline is F0 through F6 in a fixed order
    //#when we read the ordered steps
    //#then all twelve markers appear in ascending index order
    let previous = -1
    for (const marker of STEP_MARKERS) {
      const index = BUG_FIX_TEMPLATE.indexOf(marker)
      expect(index).toBeGreaterThan(previous)
      previous = index
    }
  })

  test("should document gates G1 through G5", () => {
    //#given five gates decide whether a patch is plausible
    //#when we read the gates section
    //#then every gate and its criterion are named
    expect(BUG_FIX_TEMPLATE).toContain("G1 test-integrity")
    expect(BUG_FIX_TEMPLATE).toContain("G2 reproducer flip")
    expect(BUG_FIX_TEMPLATE).toContain("G3 full suite")
    expect(BUG_FIX_TEMPLATE).toContain("G4 coverage")
    expect(BUG_FIX_TEMPLATE).toContain("G5 mutation")
    expect(BUG_FIX_TEMPLATE).toContain("sha256sum")
    expect(BUG_FIX_TEMPLATE).toContain("lcov")
  })

  test("should state the reproducer execution contract", () => {
    //#given the reproducer contract must be implementable from the template alone
    //#when we read the execution contract
    //#then the runtime form, cwd, timeout, output cap, and signature steps are present
    expect(BUG_FIX_TEMPLATE).toContain(
      "bun test <absolute path to .matrixx/bugs/<run-N>/reproducers/<file>>",
    )
    expect(BUG_FIX_TEMPLATE).toContain("cwd is always the checkout root")
    expect(BUG_FIX_TEMPLATE).toContain("120000 ms")
    expect(BUG_FIX_TEMPLATE).toContain("65536 bytes")
    expect(BUG_FIX_TEMPLATE).toContain("64 KiB")
    expect(BUG_FIX_TEMPLATE).toContain("signature_payload")
    expect(BUG_FIX_TEMPLATE).toContain("signature_hash")
    expect(BUG_FIX_TEMPLATE).toContain("3/3")
  })

  test("should carry the write-capable forbid list", () => {
    //#given this command can write unlike /bug-hunt
    //#when we read the forbid list
    //#then every write-capable denial is explicit
    expect(BUG_FIX_TEMPLATE).toContain("NO editing PRE-EXISTING tests/**")
    expect(BUG_FIX_TEMPLATE).toContain(
      "NO editing configs, lockfiles, workflows, CI files, package.json, tsconfig, biome.json, bunfig.toml",
    )
    expect(BUG_FIX_TEMPLATE).toContain("NO new dependencies")
    expect(BUG_FIX_TEMPLATE).toContain("NO commits to dev or master")
    expect(BUG_FIX_TEMPLATE).toContain("NO gh pr merge")
    expect(BUG_FIX_TEMPLATE).toContain("NO squash")
    expect(BUG_FIX_TEMPLATE).toContain("NO force push")
    expect(BUG_FIX_TEMPLATE).toContain("NO --no-verify")
    expect(BUG_FIX_TEMPLATE).toContain("NO network probes")
    expect(BUG_FIX_TEMPLATE).toContain("outside the fix worktree")
    expect(BUG_FIX_TEMPLATE).toContain("secrets")
  })

  test("should name the branch, draft PR, and base branch", () => {
    //#given delivery is a draft PR a human merges
    //#when we read the delivery steps
    //#then the branch name, draft PR form, and base dev are stated
    expect(BUG_FIX_TEMPLATE).toContain("fix/bug-hunt-<run-N>")
    expect(BUG_FIX_TEMPLATE).toContain("gh pr create --draft")
    expect(BUG_FIX_TEMPLATE).toContain("--base dev")
  })

  test("should use only the four statuses and no affirmative resolution claim", () => {
    //#given the status vocabulary is closed
    //#when we read the template
    //#then all four statuses appear and the banned affirmatives do not
    expect(BUG_FIX_TEMPLATE).toContain("plausible")
    expect(BUG_FIX_TEMPLATE).toContain("rejected")
    expect(BUG_FIX_TEMPLATE).toContain("abandoned")
    expect(BUG_FIX_TEMPLATE).toContain("unreproducible")
    expect(BUG_FIX_TEMPLATE).not.toMatch(/\bfixed\b/i)
    expect(BUG_FIX_TEMPLATE).not.toMatch(/\bcorrect\b/i)
  })

  test("should contain no raw backtick or template interpolation", () => {
    //#given the template is a single template literal
    //#when we inspect the runtime string
    //#then no unescaped backtick or interpolation marker leaked into the prose
    expect(BUG_FIX_TEMPLATE).not.toContain(BACKTICK)
    expect(BUG_FIX_TEMPLATE).not.toContain("${")
  })

  test("should define the artifact and report section", () => {
    //#given records are the artifact a human may trust
    //#when we read the report section
    //#then the artifact paths, record-last rule, and report contents are present
    expect(BUG_FIX_TEMPLATE).toContain(".matrixx/bugs/<run-N>/fixes/fix-<fp>.json")
    expect(BUG_FIX_TEMPLATE).toContain("patches/<fp>.diff")
    expect(BUG_FIX_TEMPLATE).toContain("evidence/")
    expect(BUG_FIX_TEMPLATE).toContain("Write the fix record LAST")
    expect(BUG_FIX_TEMPLATE).toContain("per-status counts")
    expect(BUG_FIX_TEMPLATE).toContain('"timeout-only"')
  })

  test("should preserve the user-request placeholder", () => {
    //#given the command wrapper contract
    //#when we read the template tail
    //#then the arguments placeholder is present
    expect(BUG_FIX_TEMPLATE).toContain("<user-request>")
    expect(BUG_FIX_TEMPLATE).toContain("$ARGUMENTS")
  })
})

describe("bug-fix command registration", () => {
  test("should register bug-fix in buildBuiltinCommandEntries with the exact hint", () => {
    //#given the builtin command registry
    //#when we load all builtin commands
    //#then bug-fix is present with the documented argument hint
    const entries = buildBuiltinCommandEntries()
    expect(Object.keys(entries)).toContain("bug-fix")
    expect(BUILTIN_COMMAND_DEFINITIONS["bug-fix"].argumentHint).toBe(ARGUMENT_HINT)
  })

  test("should wrap the template and describe a write-capable draft flow", () => {
    //#given the registered bug-fix definition
    //#when we read its template and description
    //#then it uses the command-instruction envelope and is not read-only
    const definition = BUILTIN_COMMAND_DEFINITIONS["bug-fix"]
    expect(definition.template).toContain("<command-instruction>")
    expect(definition.template).toContain(BUG_FIX_TEMPLATE)
    expect(definition.description).toContain("write-capable")
    expect(definition.description).toContain("draft")
    expect(definition.description).not.toContain("read-only")
  })

  test("should accept bug-fix and bug-hunt in the config enum", () => {
    //#given the command schema must accept both bug commands
    //#when we parse known and bogus names
    //#then bug-fix and bug-hunt parse and a bogus name is rejected
    expect(BuiltinCommandNameSchema.safeParse("bug-hunt").success).toBe(true)
    expect(BuiltinCommandNameSchema.safeParse("bug-fix").success).toBe(true)
    expect(BuiltinCommandNameSchema.safeParse("bug-fix-bogus").success).toBe(false)
  })
})
