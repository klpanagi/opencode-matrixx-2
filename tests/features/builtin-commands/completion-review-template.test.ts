/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { buildBuiltinCommandEntries } from "../../../src/features/builtin-commands/commands.transform"
import { COMPLETION_REVIEW_TEMPLATE } from "../../../src/features/builtin-commands/templates/completion-review"

const REPO_ROOT = resolve(import.meta.dir, "../../..")

describe("/completion-review command template", () => {
  test("is registered as a builtin command", () => {
    //#given the builtin command registry
    //#when it is loaded
    const commands = buildBuiltinCommandEntries()

    //#then /completion-review is present
    expect(commands["completion-review"]).toBeDefined()
    expect(commands["completion-review"]?.name).toBe("completion-review")
  })

  test("can be disabled by name", () => {
    //#given the builtin command registry
    //#when completion-review is in the disabled list
    const commands = buildBuiltinCommandEntries(["completion-review"])

    //#then it is absent
    expect(commands["completion-review"]).toBeUndefined()
  })

  test("takes an explicit plan argument", () => {
    //#given the command definition source
    const source = readFileSync(join(REPO_ROOT, "src/features/builtin-commands/commands.ts"), "utf8")
    const entry = source.slice(source.indexOf('"completion-review": {'))

    //#when its argument hint is read
    //#then the plan name is the argument, and it is not optional
    expect(entry).toContain('argumentHint: "<plan-name>"')
  })

  test("states in TEXT that this is the ONLY trigger", () => {
    //#given the template text
    //#when the triggering section is read
    //#then it names the prohibition on every automatic path
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/ONLY trigger/i)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/no hook/i)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/session\.idle/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/progress\.isComplete/)
  })

  test("errors clearly and stops when plan_list returns no match", () => {
    //#given the template text
    //#when the resolution step is read
    //#then it names the silent-skip failure and forbids proceeding on an empty resolution
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/plan_list/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/returned no match/i)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/never proceed on an empty or partial resolution/i)
  })

  test("admits on a conjunction and never on isComplete alone", () => {
    //#given the template text
    //#when the admission step is read
    //#then both clauses of the conjunction are stated
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/isComplete === true/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/needsTriage === false/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/never on `isComplete` alone/i)
  })

  test("embeds the gate's own honesty notice, so the warning cannot drift from the code", () => {
    //#given the exported heuristic warning
    const warning = COMPLETION_REVIEW_TEMPLATE

    //#when the template is read
    //#then it carries the same text the gate module exports
    expect(warning).toContain("HEURISTIC")
    expect(warning).toMatch(/BOTH directions/)
  })

  test("proceeds and records a disagreement instead of picking a winner", () => {
    //#given the template text
    //#when the disagreement step is read
    //#then it mandates PROCEED and the gateDisagreement field
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/gateDisagreement/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/never silently pick a winner/i)
  })

  test("treats structural absence as its own state", () => {
    //#given the template text
    //#when the unavailable step is read
    //#then it forbids emitting a disagreement in the absent-corroboration case
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/gateEvidence: "unavailable"/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/MUST NOT emit a `gateDisagreement`/)
  })

  test("names every shipped pipeline stage in the plan's order", () => {
    //#given the template text
    //#when the pipeline steps are read
    //#then gather, merovingian, rubric, render, report-path appear
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/gatherCompletionReviewInputs/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/merovingian/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/scoreRubric|evaluateReview/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/writeReviewReport/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/buildReviewDirCommand/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/detectMissingModelSections\(buildSectionIndex\(planContent\)\)/)
  })

  test("forbids writing into the plan file and blocking on a low score", () => {
    //#given the template text
    //#when its constraints are read
    //#then both prohibitions are present in text
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/Never write the report into the plan file/)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/advisory/i)
    expect(COMPLETION_REVIEW_TEMPLATE).toMatch(/four required parts/i)
  })
})
