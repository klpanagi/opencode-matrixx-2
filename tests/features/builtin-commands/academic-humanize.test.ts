import { describe, expect, test } from "bun:test"
import { BuiltinCommandNameSchema } from "../../../src/config/schema/commands"
import { BUILTIN_COMMAND_DEFINITIONS } from "../../../src/features/builtin-commands/commands"
import { buildBuiltinCommandEntries } from "../../../src/features/builtin-commands/commands.transform"
import {
  ACADEMIC_HUMANIZE_TEMPLATE,
} from "../../../src/features/builtin-commands/templates/academic-humanize"
import type { BuiltinCommandName } from "../../../src/features/builtin-commands/types"

describe("ACADEMIC_HUMANIZE_TEMPLATE", () => {
  test("should export a non-empty template string", () => {
    //#given the academic-humanize template
    //#when we access the template
    //#then it should be a non-empty string
    expect(typeof ACADEMIC_HUMANIZE_TEMPLATE).toBe("string")
    expect(ACADEMIC_HUMANIZE_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("should document the CLI shape", () => {
    //#given the academic-humanize template
    //#when we read the usage block
    //#then it documents the command name, modes, voice sample, venue, and dry-run flag
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("/academic-humanize")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("--mode=paper|proposal|auto")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("voice-from")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("venue")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("--dry-run")
  })

  test("should carry all six skill layers", () => {
    //#given the academic-humanize template
    //#when we read the skill rules
    //#then every layer heading from the upstream skill is present
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 1: General AI-tell catalog")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 2: Academic AI tells")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 3: Preserve these")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 4: Claim-evidence discipline")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 5: Voice and venue matching")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("Layer 6: Funding-proposal mode")
  })

  test("should state the preservation and non-goal guardrails", () => {
    //#given the academic-humanize template
    //#when we read the guardrails
    //#then it forbids changing scholarship and forbids detector evasion
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("never changes a number, result,")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("never invents findings, data, funding")
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("NOT for detector evasion")
  })

  test("should keep audit-before-rewrite and approval-gated editing", () => {
    //#given the academic-humanize template
    //#when we read the workflow phases
    //#then audit precedes rewrite and edits are never auto-applied silently
    const auditIndex = ACADEMIC_HUMANIZE_TEMPLATE.indexOf("PHASE 1")
    const rewriteIndex = ACADEMIC_HUMANIZE_TEMPLATE.indexOf("PHASE 2")
    expect(auditIndex).toBeGreaterThan(-1)
    expect(rewriteIndex).toBeGreaterThan(auditIndex)
    expect(ACADEMIC_HUMANIZE_TEMPLATE).toContain("never auto-apply")
  })
})

describe("academic-humanize command registration", () => {
  test("should register the command in builtin command entries", () => {
    //#given no disabled commands
    //#when we build the builtin command entries
    //#then academic-humanize is present with its template and argument hint
    const commands = buildBuiltinCommandEntries()

    expect(commands["academic-humanize"]).toBeDefined()
    expect(commands["academic-humanize"].name).toBe("academic-humanize")
    expect(commands["academic-humanize"].template).toContain(ACADEMIC_HUMANIZE_TEMPLATE)
    expect(commands["academic-humanize"].template).toContain("$ARGUMENTS")
    expect(BUILTIN_COMMAND_DEFINITIONS["academic-humanize"].argumentHint).toContain(
      "--mode=paper|proposal|auto",
    )
  })

  test("should exclude the command when disabled", () => {
    //#given academic-humanize is disabled
    //#when we build the builtin command entries
    //#then it is not registered
    const disabledCommands: BuiltinCommandName[] = ["academic-humanize"]

    const commands = buildBuiltinCommandEntries(disabledCommands)

    expect(commands["academic-humanize"]).toBeUndefined()
  })

  test("should be accepted by the config schema", () => {
    //#given the builtin command name schema
    //#when we parse the new command name
    //#then it is a valid builtin command
    expect(BuiltinCommandNameSchema.safeParse("academic-humanize").success).toBe(true)
  })
})
