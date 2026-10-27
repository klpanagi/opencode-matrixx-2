import { describe, expect, test } from "bun:test"
import { gitMasterSkill } from "../../src/skills/skills/git-master"
import { softwareDevSkill } from "../../src/skills/skills/software-dev"

describe("software-dev worktree-first BUILD + SHIP hardening (Item 6)", () => {
  test("BUILD gains worktree-first create/use entry", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for worktree-first entry
    //#then worktree create command present (git worktree add or worktree_create)
    expect(template).toMatch(/git worktree add|worktree_create/)
    expect(template).toMatch(/WORKTREE-FIRST/)
  })

  test("SHIP hardens env-detect (worktree vs in-place)", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for env-detect
    //#then env-detect + worktree vs in-place recorded
    expect(template).toMatch(/env-detect/i)
    expect(template).toMatch(/worktree vs in-place/i)
  })

  test("SHIP hardens merge-verify (checks green before merge)", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for merge-verify
    //#then merge-verify + green checks before merge
    expect(template).toMatch(/merge-verify/i)
    expect(template).toMatch(/checks green before merge/i)
  })

  test("SHIP hardens cleanup (remove worktree after merge)", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for cleanup
    //#then worktree remove/prune cleanup present
    expect(template).toMatch(/cleanup/i)
    expect(template).toMatch(/git worktree remove|worktree.*remove/i)
  })

  test("SHIP restates PR target dev never master", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for PR law
    //#then dev target present, master only in NEVER context
    expect(template).toMatch(/PR targeting dev/i)
    expect(template).toMatch(/dev, never master/i)
    expect(template).not.toMatch(/targeting master|target master/i)
  })

  test("SHIP mandates merge commit only never squash merge", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when scanned for merge rule
    //#then merge commit only + never squash, no prescriptive squash merge
    expect(template).toMatch(/merge commit ONLY/i)
    expect(template).toMatch(/never squash/i)
    expect(template).not.toMatch(/use squash merge|perform.*squash merge|prefer.*squash/i)
  })

  test("worktree sections sit before ANTI-PATTERNS with distinct anchors", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when section order compared
    //#then WORKTREE-FIRST precedes ANTI-PATTERNS, distinct from LEDGER/RULINGS
    const worktreeIdx = template.indexOf("## WORKTREE-FIRST")
    const antiIdx = template.indexOf("## ANTI-PATTERNS")
    const ledgerIdx = template.indexOf("## PROGRESS LEDGER")
    const rulingsIdx = template.indexOf("## RULINGS NOT STALLS")
    expect(worktreeIdx).toBeGreaterThanOrEqual(0)
    expect(antiIdx).toBeGreaterThan(worktreeIdx)
    expect(ledgerIdx).toBeGreaterThanOrEqual(0)
    expect(rulingsIdx).toBeGreaterThan(ledgerIdx)
    expect(worktreeIdx).not.toBe(ledgerIdx)
    expect(worktreeIdx).not.toBe(rulingsIdx)
  })
})

describe("git-master worktree procedures consistent with software-dev SHIP", () => {
  test("git-master documents worktree create/list/remove procedures", () => {
    //#given template
    const template = gitMasterSkill.template

    //#when scanned for worktree ops
    //#then create/list/remove all present
    expect(template).toMatch(/git worktree add/)
    expect(template).toMatch(/git worktree list/)
    expect(template).toMatch(/git worktree remove/)
  })

  test("git-master restates PR dev never master + merge commit only", () => {
    //#given template
    const template = gitMasterSkill.template

    //#when scanned for repo law
    //#then dev target + merge commit only, never squash merge
    expect(template).toMatch(/dev, never master/i)
    expect(template).toMatch(/merge commit ONLY/i)
    expect(template).toMatch(/never squash/i)
  })
})
