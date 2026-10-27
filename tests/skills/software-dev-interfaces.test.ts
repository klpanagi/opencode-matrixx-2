import { describe, expect, test } from "bun:test"
import { softwareDevSkill } from "../../src/skills/skills/software-dev"

describe("software-dev Consumes/Produces interface guidance (Wave 1 prose only)", () => {
  test("template contains Consumes and Produces interface contract labels", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for interface contract labels
    //#then both labels present
    expect(template).toContain("Consumes")
    expect(template).toContain("Produces")
  })

  test("template phrases labels as REQUIRED-task-subfield guidance", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for subfield voice
    //#then REQUIRED-task-subfield voice present near interface labels
    expect(template).toMatch(/REQUIRED-task-subfield/i)
  })

  test("template provides code-fence example with exit criteria", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for code-fence + exit-criteria style
    //#then interface section follows phase style
    expect(template).toMatch(/## TASK INTERFACES/)
    expect(template).toContain("```")
    expect(template).toMatch(/\*\*Exit criteria:\*\*/)
  })

  test("template states enforcement lands in Wave 2 (guidance only)", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for non-enforcement disclaimer
    //#then Wave 2 deferral explicitly stated
    expect(template).toMatch(/Wave 2/)
    expect(template).toMatch(/guidance only/i)
  })

  test("template states labels are forward-compatible with Task 6 grammar", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for forward-compat marker
    //#then Task 6 grammar promotion noted
    expect(template).toMatch(/Task 6/)
    expect(template).toMatch(/forward-compatible/i)
  })

  test("template documents Consumes before Produces in dependency order", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when positions compared
    //#then Consumes precedes Produces in the interface section
    const sectionIdx = template.indexOf("## TASK INTERFACES")
    expect(sectionIdx).toBeGreaterThanOrEqual(0)
    const consumesIdx = template.indexOf("Consumes", sectionIdx)
    const producesIdx = template.indexOf("Produces", sectionIdx)
    expect(consumesIdx).toBeGreaterThanOrEqual(0)
    expect(producesIdx).toBeGreaterThanOrEqual(0)
    expect(consumesIdx).toBeLessThan(producesIdx)
  })
})
