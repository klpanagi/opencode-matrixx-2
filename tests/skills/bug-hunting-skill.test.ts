import { describe, expect, test } from "bun:test"
import { BUG_HUNTING_SKILL_NAME, bugHuntingSkill } from "../../src/skills/builtin/core/bug-hunting"
import { createBuiltinSkills } from "../../src/skills/loader/factories"

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]
const TIERS = ["E0", "E1", "E2", "E3"]

describe("bug-hunting skill", () => {
  test("factory registers skill via lazy wrapper", () => {
    //#given direct skill object
    //#when created through the factory
    const skills = createBuiltinSkills()
    const skill = skills.find((s) => s.name === BUG_HUNTING_SKILL_NAME)

    //#then registered and template matches the eager module content
    expect(skill).toBeDefined()
    expect(skill!.template).toBe(bugHuntingSkill.template)
    expect(bugHuntingSkill.name).toBe("bug-hunting")
  })

  test("SDO description is valid (trigger, token budget, related)", () => {
    //#given the skill description
    const description = bugHuntingSkill.description

    //#when checked against the SDO rules
    const first120 = description.slice(0, 120)
    const tokens = description.split(/\s+/).filter(Boolean).length
    const related = description.match(/Related:\s*([^.]+)/i)?.[1].split(",").map((s) => s.trim()) ?? []

    //#then the trigger is early, the budget holds, and related is capped at two
    expect(/Use when/i.test(first120)).toBe(true)
    expect(tokens).toBeLessThanOrEqual(150)
    expect(related.length).toBeLessThanOrEqual(2)
    expect(description).not.toMatch(/MUST USE|STRONGLY RECOMMENDED/i)
  })

  test("template contains all ten stage markers", () => {
    //#given the skill template
    const template = bugHuntingSkill.template

    //#when scanned for stage markers
    //#then every stage S0..S9 appears
    for (const stage of STAGES) {
      expect(template).toContain(stage)
    }
  })

  test("template contains the four evidence tiers and needs_validation", () => {
    //#given the skill template
    const template = bugHuntingSkill.template

    //#when scanned for the evidence ladder
    //#then every tier marker and the candidate status are documented
    for (const tier of TIERS) {
      expect(template).toContain(tier)
    }
    expect(template).toContain("needs_validation")
  })

  test("template states the evidence rule and the severity caps", () => {
    //#given the skill template
    const template = bugHuntingSkill.template

    //#when scanned for the hard rules
    //#then the tier rule and the E1 severity cap are explicit
    expect(template.toLowerCase()).toContain("no severity without an evidence tier")
    expect(template).toMatch(/capped at medium|cap(ped)? at medium/i)
    expect(template).toMatch(/hypothesis is not a finding/i)
  })

  test("template documents the tool matrix and security delegation", () => {
    //#given the skill template
    const template = bugHuntingSkill.template

    //#when scanned for language support and delegation
    //#then first-class, best-effort, out-of-scope, and cross_ref are all present
    expect(template).toContain("out_of_scope")
    expect(template).toMatch(/clang-tidy/i)
    expect(template).toMatch(/go vet/i)
    expect(template).toContain("cross_ref")
    expect(template).toContain("security-audit")
  })
})
