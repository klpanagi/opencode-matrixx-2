import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ORACLE_INTERVIEW_MODE } from "../../src/agents/oracle/interview-mode"

const REPO_ROOT = join(import.meta.dir, "..", "..")

describe("Oracle interview Seraph handoff artifact (Item 8)", () => {
  test("handoff artifact template present with lossless fields", () => {
    //#given the Oracle interview-mode prompt
    //#when scanned for the handoff artifact
    //#then goal, decisions, gaps, resolutions, and ledger pointer all present
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Seraph Handoff/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/\*\*Goal\*\*|^- Goal:/im)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Key Discussions/)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Gaps caught/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Resolutions/)
    expect(ORACLE_INTERVIEW_MODE).toMatch(
      /\.matrixx\/evidence\/\{plan\}\/progress\.md/,
    )
  })

  test("artifact fields mirror Seraph gap categories", () => {
    //#given the interview prompt handoff prose
    //#when compared against Seraph's real gap categories
    //#then missed questions, guardrails, scope-creep, acceptance, edge cases, premises all named
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Missed questions/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Guardrails/)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Scope-creep|scope creep/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Acceptance gaps|acceptance criteria/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Edge cases/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Premises verified|construction site/i)
  })

  test("approach-pick requires defaults + rationale when user skips questions", () => {
    //#given the interview prompt
    //#when scanned for approach-pick prose
    //#then skipped-question defaults with rationale required, A1/A2/A3 precedent cited
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Approach-pick/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/skips.*questions|skipped question/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/rationale/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/DEFAULTS A1\/A2\/A3|A1.*A2.*A3/)
  })

  test("Spike escape hatch has time-box + exit criteria", () => {
    //#given the interview prompt
    //#when scanned for the Spike hatch
    //#then time-box duration and exit criteria present
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Spike/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/time-box/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/Exit criteria/i)
  })

  test("handoff cites Task 5 SHIP worktree pattern", () => {
    //#given the interview prompt
    //#when scanned for Task 5 grounding
    //#then worktree-first SHIP mechanics referenced with dev law
    expect(ORACLE_INTERVIEW_MODE).toMatch(/worktree/i)
    expect(ORACLE_INTERVIEW_MODE).toMatch(/dev, never master|dev never master/i)
  })

  test("zero human-manual QA phrases in interview-mode source", () => {
    //#given the interview-mode source file
    const source = readFileSync(
      join(REPO_ROOT, "src/agents/oracle/interview-mode.ts"),
      "utf8",
    )

    //#when scanned for manual-QA phrases
    //#then zero hits — all scenarios agent-executed
    expect(source).not.toMatch(/manually confirm/i)
    expect(source).not.toMatch(/visually confirm/i)
    expect(source).not.toMatch(/ask user to verify/i)
  })
})
