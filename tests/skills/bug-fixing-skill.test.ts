import { describe, expect, test } from "bun:test"
import { BuiltinSkillNameSchema } from "../../src/config/schema/agent-names"
import { BUG_FIXING_SKILL_NAME, bugFixingSkill } from "../../src/skills/builtin/core/bug-fixing"
import { createBuiltinSkills } from "../../src/skills/loader/factories"

const PIPELINE_STAGES = ["F0", "F1", "F2", "F3", "F4", "F5", "F6"]
const GATES = ["G1", "G2", "G3", "G4", "G5"]
const STATUSES = ["plausible", "rejected", "abandoned", "unreproducible"]

describe("bug-fixing skill", () => {
  test("factory registers skill via lazy wrapper", () => {
    //#given direct skill object
    //#when created through the factory
    const skills = createBuiltinSkills()
    const skill = skills.find((s) => s.name === BUG_FIXING_SKILL_NAME)

    //#then registered and template matches the eager module content
    expect(skill).toBeDefined()
    expect(skill!.template).toBe(bugFixingSkill.template)
    expect(bugFixingSkill.name).toBe("bug-fixing")
  })

  test("SDO description is valid (trigger, token budget, related)", () => {
    //#given the skill description
    const description = bugFixingSkill.description

    //#when checked against the SDO rules
    const first120 = description.slice(0, 120)
    const tokens = description.split(/\s+/).filter(Boolean).length
    const related = description.match(/Related:\s*([^.]+)/i)?.[1].split(",").map((s) => s.trim()) ?? []

    //#then the trigger is early, the budget holds, and related is capped at two
    expect(first120.startsWith("Use when")).toBe(true)
    expect(tokens).toBeLessThanOrEqual(150)
    expect(related.length).toBeLessThanOrEqual(2)
    expect(related).toContain("bug-hunting")
    expect(description).not.toMatch(/MUST USE|STRONGLY RECOMMENDED/i)
  })

  test("template contains the F0-F6 pipeline stages and G1-G5 gates", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for pipeline and gate markers
    //#then every stage and gate appears
    for (const stage of PIPELINE_STAGES) {
      expect(template).toContain(stage)
    }
    for (const gate of GATES) {
      expect(template).toContain(gate)
    }
  })

  test("template documents the eligibility rule", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for eligibility
    //#then only E2/E3 are accepted and E0/E1 plus cross_ref are refused
    expect(template).toContain("E2")
    expect(template).toContain("E3")
    expect(template).toContain("E0")
    expect(template).toContain("E1")
    expect(template).toContain("cross_ref")
    expect(template.toLowerCase()).toContain("ineligible")
  })

  test("template uses only the four statuses and bans fixed/correct claims", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for the status vocabulary
    //#then every permitted status is defined
    for (const status of STATUSES) {
      expect(template).toContain(status)
    }

    //#then the sanctioned negation is present exactly as written
    expect(template).toContain("A plausible patch is not a correct patch")

    //#then the ban on affirmative fixed/correct artifact language is explicit
    expect(template.toLowerCase()).toContain('never "fixed"')
    expect(template).toContain("affirmative")
  })

  test("template states the reproducer execution contract", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for the execution contract
    //#then the timeout, output cap, cwd rule, absolute path, and sha256 signature are all present
    expect(template).toContain("120000 ms")
    expect(template).toContain("120000")
    expect(template).toContain("64 KiB")
    expect(template).toContain("65536")
    expect(template.toLowerCase()).toContain("cwd")
    expect(template.toLowerCase()).toContain("checkout root")
    expect(template).toContain("absolute path")
    expect(template).toContain("sha256")
    expect(template).toContain("signature")
    expect(template.toLowerCase()).toContain("3/3")
  })

  test("template states the --allow-exec precondition and timeout-only sandbox", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for the execution safety model
    //#then the flag is mandatory and the sandbox claim is honest
    expect(template).toContain("--allow-exec")
    expect(template.toLowerCase()).toContain("required")
    expect(template).toContain('sandbox: "timeout-only"')
    expect(template.toLowerCase()).toContain("network isolation is not provided")
  })

  test("template requires an independent verifier (hunter is not verifier)", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for the verification requirement
    //#then self-approval is explicitly rejected
    expect(template.toLowerCase()).toContain("fresh verifier")
    expect(template).toContain("hunter")
    expect(template.toLowerCase()).toContain("self-approval")
  })

  test("template documents what the pipeline does not prove", () => {
    //#given the skill template
    const template = bugFixingSkill.template

    //#when scanned for the limits section
    //#then both citations and the no-auto-merge statement are present
    expect(template.toLowerCase()).toContain("what this does not prove")
    expect(template).toContain("10.1145/2771783.2771791")
    expect(template).toContain("10.1145/2786805.2786825")
    expect(template).toContain("SapFix")
    expect(template).toContain("Getafix")
  })

  test("BuiltinSkillNameSchema accepts bug-fixing", () => {
    //#given the built-in skill name schema
    //#when parsing the new skill name
    const result = BuiltinSkillNameSchema.safeParse("bug-fixing")

    //#then it is accepted
    expect(result.success).toBe(true)
  })
})
