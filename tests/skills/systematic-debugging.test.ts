import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "../../src/skills/skills"
import { systematicDebuggingSkill } from "../../src/skills/skills/systematic-debugging"

describe("systematic-debugging skill", () => {
  test("factory registers skill via lazy wrapper", () => {
    //#given direct skill object
    //#when created through factory
    const skills = createBuiltinSkills()
    const skill = skills.find((s) => s.name === "systematic-debugging")

    //#then registered and template matches eager content
    expect(skill).toBeDefined()
    void skill!.template // trigger lazy hydration
    expect(skill!.template).toBe(systematicDebuggingSkill.template)
    expect(systematicDebuggingSkill.name).toBe("systematic-debugging")
  })

  test("description follows SDO with Use-when trigger in first 120 chars", () => {
    //#given skill description
    const description = systematicDebuggingSkill.description

    //#when scanned for SDO trigger
    //#then Use-when trigger survives truncation
    expect(description.slice(0, 120)).toMatch(/Use when/i)
    expect(description).toMatch(/Related:/)
  })

  test("template contains Phase-1 root-cause gate in reproduce-isolate-hypothesize-verify order", () => {
    //#given template
    const template = systematicDebuggingSkill.template

    //#when scanned for gate phases
    //#then all four phases present in order
    const phases = ["REPRODUCE", "ISOLATE", "HYPOTHESIZE", "VERIFY"]
    for (const phase of phases) {
      expect(template).toContain(phase)
    }
    const order = phases.map((p) => template.indexOf(p))
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).toEqual(sorted)
  })

  test("template contains delete-code-first corollary", () => {
    //#given template
    const template = systematicDebuggingSkill.template

    //#when scanned for corollary markers
    //#then deletion-first guidance present
    expect(template).toMatch(/delete-code-first/i)
    expect(template).toMatch(/prefer removing code/i)
  })

  test("template declares tests/ mirror as source of truth with CI citations", () => {
    //#given template
    const template = systematicDebuggingSkill.template

    //#when scanned for placement truth
    //#then mirror placement plus CI discovery citations present
    expect(template).toMatch(/tests\/ mirror/i)
    expect(template).toContain("find tests script")
    expect(template).toMatch(/CI-orphaned/)
    expect(template).toContain("script/mock-heavy-list.txt")
    expect(template).toContain("script/run-ci.sh")
  })

  test("template aligns with software-dev BUILD RED-GREEN-REFACTOR", () => {
    //#given template
    const template = systematicDebuggingSkill.template

    //#when scanned for TDD alignment
    //#then RED-GREEN-REFACTOR cycle stated, repro equals RED
    expect(template).toContain("RED")
    expect(template).toContain("GREEN")
    expect(template).toMatch(/RED-GREEN-REFACTOR/)
    expect(template).toMatch(/software-dev/)
  })
})
