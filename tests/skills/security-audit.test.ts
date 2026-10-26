import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "../../src/skills/skills"
import { SECURITY_AUDIT_SKILL_NAME, securityAuditSkill } from "../../src/skills/skills/security-audit"

describe("security-audit skill", () => {
  test("factory registers skill via lazy wrapper", () => {
    //#given direct skill object
    //#when created through factory
    const skills = createBuiltinSkills()
    const skill = skills.find((s) => s.name === SECURITY_AUDIT_SKILL_NAME)

    //#then registered and template matches eager content
    expect(skill).toBeDefined()
    void skill!.template // trigger lazy hydration
    expect(skill!.template).toBe(securityAuditSkill.template)
    expect(securityAuditSkill.name).toBe("security-audit")
  })

  test("SDO description is valid (trigger, token budget, related)", () => {
    //#given description
    const description = securityAuditSkill.description

    //#when checked against SDO rules
    const first120 = description.slice(0, 120)
    const tokens = description.split(/\s+/).filter(Boolean).length
    const related = description.match(/Related:\s*([^.]+)/i)?.[1].split(",").map((s) => s.trim()) ?? []

    //#then trigger early, within budget, max 2 related
    expect(/Use when/i.test(first120)).toBe(true)
    expect(tokens).toBeLessThanOrEqual(150)
    expect(related.length).toBeLessThanOrEqual(2)
    expect(description).not.toMatch(/MUST USE|STRONGLY RECOMMENDED/i)
  })

  test("template contains 6-phase markers and required rules", () => {
    //#given template
    const template = securityAuditSkill.template

    //#when scanned for phase markers
    //#then all 6 phases plus workflow rules present
    expect(template).toContain("Phase 1")
    expect(template).toContain("Recon")
    expect(template).toContain("Phase 2")
    expect(template).toContain("Hunting waves")
    expect(template).toContain("Phase 3")
    expect(template).toContain("fresh verifier")
    expect(template).toContain("Phase 4")
    expect(template).toMatch(/findings\.json.*ledger|ledger.*findings\.json/s)
    expect(template).toContain("Phase 5")
    expect(template).toContain("Independent verification")
    expect(template).toContain("Phase 6")
    expect(template).toContain("Target-neutral")
    expect(template).toMatch(/hunter.*verifier|verifier.*hunter/i)
    expect(template).toContain("--full")
    expect(template).toMatch(/budget/i)
    expect(template).toContain(".matrixx/audits/")
    expect(template).toMatch(/read-only|Read-only/i)
    expect(template).toMatch(/no live probing/i)
    expect(template).toContain("security-core")
    expect(template).toContain("security-review")
    expect(template).toMatch(/UNVERIFIED/)
  })
})
