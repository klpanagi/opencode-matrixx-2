import { describe, expect, test } from "bun:test"
import { softwareDevSkill } from "../../src/skills/builtin/core/software-dev"

describe("software-dev Consumes/Produces interface guidance", () => {
  test("template contains Consumes and Produces interface contract labels", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for interface contract labels
    //#then both labels present
    expect(template).toContain("Consumes")
    expect(template).toContain("Produces")
  })

  test("template defines both labels as task interface fields", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for the interface contract definition
    //#then both labels are described as upstream/downstream fields
    expect(template).toMatch(/Consumes.*upstream inputs/i)
    expect(template).toMatch(/Produces.*downstream outputs/i)
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

  test("template requires declaring Consumes before Produces in dependency order", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for the ordering rule
    //#then dependency order is stated explicitly
    expect(template).toMatch(/Declare Consumes before Produces, in dependency order/i)
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
