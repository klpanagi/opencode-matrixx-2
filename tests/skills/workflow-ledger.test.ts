import { describe, expect, test } from "bun:test"
import { softwareDevSkill } from "../../src/skills/builtin/core/software-dev"

describe("software-dev rulings-not-stalls workflow prose", () => {
  test("template no longer requires a progress.md ledger", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for a ledger requirement
    //#then the removed ledger path is absent
    expect(template).not.toContain(".matrixx/evidence")
    expect(template).not.toContain("progress.md")
  })

  test("rulings are recorded in task notes, not a ledger file", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for the recording mechanism
    //#then task notes are named and ledger writes are not prescribed
    expect(template).toMatch(/task\/plan notes/i)
    expect(template).not.toMatch(/logged in the ledger/i)
  })

  test("template enumerates exactly 4 stop conditions", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when stop conditions counted
    //#then exactly 4 enumerated, each with ruling + proceed action
    const hits = template.match(/Stop condition \d/g) ?? []
    expect(hits.length).toBe(4)
    for (const n of [1, 2, 3, 4]) {
      expect(template).toContain(`Stop condition ${n}`)
    }
    const rulings = template.match(/Ruling to record:/g) ?? []
    expect(rulings.length).toBe(4)
    const proceeds = template.match(/Proceed:/g) ?? []
    expect(proceeds.length).toBe(4)
  })

  test("rulings section sits before the ANTI-PATTERNS anchor", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when section order compared
    //#then the rulings H2 precedes ANTI-PATTERNS
    const rulingsIdx = template.indexOf("## RULINGS NOT STALLS")
    const antiIdx = template.indexOf("## ANTI-PATTERNS")
    expect(rulingsIdx).toBeGreaterThanOrEqual(0)
    expect(antiIdx).toBeGreaterThan(rulingsIdx)
  })
})
