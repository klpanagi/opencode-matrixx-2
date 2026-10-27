import { describe, expect, test } from "bun:test"
import { softwareDevSkill } from "../../src/skills/skills/software-dev"

describe("software-dev progress ledger + rulings-not-stalls (Item 4 workflow prose)", () => {
  test("template contains gitignored ledger path", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for ledger path + gitignore
    //#then ledger path present and marked gitignored
    expect(template).toContain(".matrixx/evidence/{plan}/progress.md")
    expect(template).toMatch(/gitignored/i)
  })

  test("template prescribes plan_*/task_* tools only for ledger writes", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for tool-only rule
    //#then plan_update/task_update named, bash writes banned
    expect(template).toMatch(/plan_update/)
    expect(template).toMatch(/task_update/)
    expect(template).toMatch(/tools only/i)
  })

  test("template prescribes no bash writes to .matrixx/ ledger", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for bash-write prescriptions
    //#then zero echo/cat-redirect writes targeting .matrixx/
    expect(template).not.toMatch(/echo[^\n]*\.matrixx/)
    expect(template).not.toMatch(/cat[^\n]*>[^\n]*\.matrixx/)
  })

  test("template cites task-edit-guard enforcement", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for enforcement citation
    //#then raw bash mutation of plans/tasks named as blocked
    expect(template).toMatch(/task-edit-guard/)
    expect(template).toMatch(/\.matrixx\/plans/)
    expect(template).toMatch(/\.matrixx\/tasks/)
    expect(template).toMatch(/blocked/i)
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

  test("ledger/rulings sections sit before ANTI-PATTERNS anchor", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when section order compared
    //#then distinct H2 anchors precede ANTI-PATTERNS
    const ledgerIdx = template.indexOf("## PROGRESS LEDGER")
    const rulingsIdx = template.indexOf("## RULINGS NOT STALLS")
    const antiIdx = template.indexOf("## ANTI-PATTERNS")
    expect(ledgerIdx).toBeGreaterThanOrEqual(0)
    expect(rulingsIdx).toBeGreaterThan(ledgerIdx)
    expect(antiIdx).toBeGreaterThan(rulingsIdx)
  })
})
