import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "../../src/skills/skills"
import { qualityGateSkill } from "../../src/skills/skills/quality-gate"

describe("quality-gate gate function", () => {
  test("factory registers skill via lazy wrapper", () => {
    //#given direct skill object
    //#when created through factory
    const skills = createBuiltinSkills()
    const skill = skills.find((s) => s.name === "quality-gate")

    //#then registered and template matches eager content
    expect(skill).toBeDefined()
    void skill!.template // trigger lazy hydration
    expect(skill!.template).toBe(qualityGateSkill.template)
    expect(qualityGateSkill.name).toBe("quality-gate")
  })

  test("template contains IDENTIFY→RUN→READ→VERIFY gate function", () => {
    //#given template
    const template = qualityGateSkill.template

    //#when scanned for gate-function steps
    //#then all four steps present in order
    expect(template).toContain("IDENTIFY")
    expect(template).toContain("RUN")
    expect(template).toContain("READ")
    expect(template).toContain("VERIFY")
    const identifyIdx = template.indexOf("IDENTIFY")
    const runIdx = template.indexOf("RUN", identifyIdx)
    const readIdx = template.indexOf("READ", runIdx)
    const verifyIdx = template.lastIndexOf("VERIFY")
    expect(identifyIdx).toBeLessThan(runIdx)
    expect(runIdx).toBeLessThan(readIdx)
    expect(readIdx).toBeLessThan(verifyIdx)
  })

  test("template contains Red Flags section with required markers", () => {
    //#given template
    const template = qualityGateSkill.template

    //#when scanned for red-flag markers
    //#then Red Flag heading plus all four markers present
    expect(template).toMatch(/Red Flag/)
    expect(template).toMatch(/suppressed errors/i)
    expect(template).toMatch(/skipped tests/i)
    expect(template).toMatch(/as-any|as any/)
    expect(template).toMatch(/unchecked warnings/i)
  })

  test("template contains Rationalization guard and VCS-diff step", () => {
    //#given template
    const template = qualityGateSkill.template

    //#when scanned for guard and diff markers
    //#then rationalization guard and git diff review present
    expect(template).toMatch(/Rationalization/i)
    expect(template).toMatch(/good enough/i)
    expect(template).toContain("git diff")
  })

  test("gate evidence phrases match software-dev VERIFY wording", () => {
    //#given template
    const template = qualityGateSkill.template

    //#when scanned for evidence phrases
    //#then phrases match software-dev VERIFY block verbatim
    expect(template).toContain("bun run lint — 0 issues")
    expect(template).toContain("bun run typecheck — no errors")
    expect(template).toContain("bun run build — success")
  })

  test("gate is prompt-only with no blocking hooks", () => {
    //#given template
    const template = qualityGateSkill.template

    //#when scanned for prompt-only markers
    //#then non-blocking prompt-only policy stated
    expect(template).toMatch(/prompt-only|non-blocking/i)
  })
})
