/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CANONICAL_SECTIONS, REQUIRED_TASK_SUBFIELDS } from "../../../src/features/plan-contract/constants"
import { renderPlanSkeleton } from "../../../src/features/plan-contract/skeleton"
import { validatePlanContract } from "../../../src/features/plan-contract/validate"

const OLD_FIXTURE = readFileSync(
  new URL("../../fixtures/plan-contract/conformant-plan.md", import.meta.url),
  "utf8",
)

// Inline old-shape plan: the 8 pre-grammar H2s and 7 pre-grammar subfields.
// The conformant fixture above has since been extended to the new 10/9 grammar,
// so old-shape assertions need their own frozen input that must NOT be extended.
const OLD_SHAPE_PLAN = `# Old-Shape Plan (pre-grammar-addition)

## TL;DR

Old summary.

## Context

Old context.

## Work Objectives

Old objectives.

## Verification Strategy (MANDATORY)

Old verification.

## Execution Strategy

Old strategy.

## TODOs

- [ ] 1. Old task

  **What to do**:
  - Old steps.

  **Must NOT do**:
  - Old exclusions.

  **Recommended Agent Profile**:
  - **Category**: \`source\`

  **Parallelization**:
  - **Can Run In Parallel**: NO

  **References**:
  - \`src/old.ts:1-10\` - old pattern.

  **Acceptance Criteria**:
  - Old criterion.

  **Agent-Executed QA Scenarios:**

  \`\`\`
  Scenario: Old scenario works
    Tool: Bash
    Steps:
      1. Run: bun test
    Expected Result: PASS
  \`\`\`

## Commit Strategy

Old commit.

## Success Criteria

- [ ] Old done
`

describe("plan-contract grammar additions (Global Constraints + Review Focus + Consumes/Produces)", () => {
  test("constants contain the new sections and subfields in canonical positions", () => {
    //#given the canonical grammar lists
    //#when inspecting membership and order
    //#then the new H2s and subfields are present in their specified slots
    expect([...CANONICAL_SECTIONS]).toContain("Global Constraints")
    expect([...CANONICAL_SECTIONS]).toContain("Review Focus")
    expect([...REQUIRED_TASK_SUBFIELDS]).toContain("Consumes")
    expect([...REQUIRED_TASK_SUBFIELDS]).toContain("Produces")
    const sections = [...CANONICAL_SECTIONS]
    expect(sections.indexOf("Global Constraints")).toBeGreaterThan(sections.indexOf("Work Objectives"))
    expect(sections.indexOf("Review Focus")).toBeGreaterThan(sections.indexOf("Execution Strategy"))
  })

  test("renderPlanSkeleton emits the new H2s and interface subfields", () => {
    //#given the canonical skeleton renderer
    //#when rendering the skeleton
    const skeleton = renderPlanSkeleton()

    //#then the new headings and subfield labels appear
    expect(skeleton).toContain("## Global Constraints")
    expect(skeleton).toContain("## Review Focus")
    expect(skeleton).toContain("**Consumes**")
    expect(skeleton).toContain("**Produces**")
  })

  test("validator warns (advisory only) on a plan missing the new H2s", () => {
    //#given an old-shape plan without the two new H2 sections
    //#when validating the contract
    const result = validatePlanContract(OLD_SHAPE_PLAN)

    //#then ok stays true and both gaps surface as missing_section warnings
    expect(result.ok).toBe(true)
    const missing = result.warnings.filter((w) => w.code === "missing_section").map((w) => w.message)
    expect(missing.some((m) => m.includes("Global Constraints"))).toBe(true)
    expect(missing.some((m) => m.includes("Review Focus"))).toBe(true)
  })

  test("old 8-section fixture with 7 old subfields stays backward compatible", () => {
    //#given the pre-grammar-addition conformant fixture
    //#when validating the contract
    const result = validatePlanContract(OLD_SHAPE_PLAN)

    //#then absence of Consumes/Produces warns but never blocks
    expect(result.ok).toBe(true)
    const missingSubfields = result.warnings.filter((w) => w.code === "missing_subfield").map((w) => w.message)
    expect(missingSubfields.some((m) => m.includes("Consumes"))).toBe(true)
    expect(missingSubfields.some((m) => m.includes("Produces"))).toBe(true)
  })

  test("rendered skeleton orders Global Constraints before Verification Strategy before Review Focus", () => {
    //#given the rendered skeleton
    //#when locating the three H2 headings
    const skeleton = renderPlanSkeleton()
    const gc = skeleton.indexOf("## Global Constraints")
    const vs = skeleton.indexOf("## Verification Strategy (MANDATORY)")
    const rf = skeleton.indexOf("## Review Focus")

    //#then the plan-wide rules precede verification, which precedes review focus
    expect(gc).toBeGreaterThan(-1)
    expect(vs).toBeGreaterThan(-1)
    expect(rf).toBeGreaterThan(-1)
    expect(gc).toBeLessThan(vs)
    expect(vs).toBeLessThan(rf)
  })
})
