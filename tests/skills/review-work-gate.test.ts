import { describe, expect, test } from "bun:test"
import { reviewWorkSkill } from "../../src/skills/skills/review-work"
import { softwareDevSkill } from "../../src/skills/skills/software-dev"

describe("review-work 5-vs-6 count drift + per-task lightweight gate (Item 7)", () => {
  test("header count is 6-agent, consistent with 6-agent body", () => {
    //#given template
    const template = reviewWorkSkill.template

    //#when header scanned
    //#then header says 6-Agent and no stale five-count remains
    expect(template).toMatch(/# Review Work - 6-Agent/)
    expect(template).not.toMatch(new RegExp("5" + "-agent", "i"))
  })

  test("Phase 1 launches all 6 agents", () => {
    //#given template
    const template = reviewWorkSkill.template

    //#when Phase 1 scanned
    //#then launch count is 6
    expect(template).toMatch(/Launch 6 Agents/)
    expect(template).toMatch(/Launch ALL 6/)
  })

  test("per-task lightweight gate prose present (1 Oracle, final-only full panel)", () => {
    //#given template
    const template = reviewWorkSkill.template

    //#when scanned for gate prose
    //#then per-task lightweight 1-Oracle gate with final-only full review
    expect(template).toMatch(/per-task/i)
    expect(template).toMatch(/lightweight/i)
    expect(template).toMatch(/1 Oracle|single Oracle/i)
    expect(template).toMatch(/final-only/i)
  })

  test("gate cites post-Task-6 subfield labels verbatim", () => {
    //#given template
    const template = reviewWorkSkill.template

    //#when gate section scanned
    //#then exact subfield labels present
    expect(template).toContain("Consumes")
    expect(template).toContain("Produces")
    expect(template).toContain("Acceptance Criteria")
    expect(template).toContain("Agent-Executed QA Scenarios")
  })

  test("gate blocks dependents until it passes (wave semantics)", () => {
    //#given template
    const template = reviewWorkSkill.template

    //#when scanned for wave semantics
    //#then dependents blocked until gate passes
    expect(template).toMatch(/dependents? blocked until/i)
    expect(template).toMatch(/gate passes/i)
  })

  test("software-dev REVIEW row consistent with 6-agent panel", () => {
    //#given template
    const template = softwareDevSkill.template

    //#when REVIEW row scanned
    //#then 6-agent, zero stale five-count drift
    expect(template).not.toMatch(new RegExp("5" + "-agent", "i"))
    expect(template).toMatch(/6-agent/)
    expect(template).toMatch(/All 6 reviewers PASS/)
  })
})
