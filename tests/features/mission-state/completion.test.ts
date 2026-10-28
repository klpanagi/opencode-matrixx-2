/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { resolvePlanCompletion } from "../../../src/features/mission-state/completion"

const ALL_DONE = "- [x] 1. Alpha\n- [x] 2. Beta\n"
const PART_DONE = "- [x] 1. Alpha\n- [ ] 2. Beta\n"
// humanize-style design doc: zero numbered tasks, 0/4 top-level prose boxes
const HUMANIZE_ZERO = "- [ ] Draft\n- [ ] Review\n- [ ] Approve\n- [ ] Merge\n"
// dwfinance-style: zero checkboxes at all
const DWFINANCE_ZERO = "# Design doc\n\nNo tasks yet, prose only.\n"

describe("resolvePlanCompletion", () => {
  test("AND-gate: complete only when checkboxes done AND status completed", () => {
    //#given all boxes checked + completed status
    const input = { content: ALL_DONE, status: "completed" as const }

    //#when resolving
    const result = resolvePlanCompletion(input.content, { status: input.status })

    //#then verdict is complete
    expect(result.verdict).toBe("complete")
    expect(result.checkbox.isComplete).toBe(true)
  })

  test("mismatch-warn when boxes done but status lags", () => {
    //#given all boxes checked but status still in_progress
    const content = ALL_DONE

    //#when resolving
    const result = resolvePlanCompletion(content, { status: "in_progress" })

    //#then mismatch warns, never complete
    expect(result.verdict).toBe("mismatch-warn")
  })

  test("mismatch-warn when status completed but boxes open", () => {
    //#given open boxes but status claims completed
    const content = PART_DONE

    //#when resolving
    const result = resolvePlanCompletion(content, { status: "completed" })

    //#then mismatch warns
    expect(result.verdict).toBe("mismatch-warn")
  })

  test("incomplete when boxes open and status not completed", () => {
    //#given open boxes + pending status
    const content = PART_DONE

    //#when resolving
    const result = resolvePlanCompletion(content, { status: "pending" })

    //#then incomplete
    expect(result.verdict).toBe("incomplete")
  })

  test("dead override flag has no effect", () => {
    //#given open boxes with pending status plus a stale override claim
    const content = PART_DONE
    const claimed = { status: "pending", forceCompletion: true }

    //#when resolving with the removed forceCompletion path
    const result = resolvePlanCompletion(content, claimed)

    //#then the claim is ignored: incomplete, never forced complete
    expect(result.verdict).toBe("incomplete")
  })

  test("triage-never-complete: zero-task plans never verdict-complete", () => {
    //#given humanize-style 0/4 dashboard: boxes open, status completed
    const humanize = resolvePlanCompletion(HUMANIZE_ZERO, { status: "completed" })

    //#when + then mismatch warns (0/4 open + completed status disagree)
    expect(humanize.checkbox.total).toBe(4)
    expect(humanize.verdict).toBe("mismatch-warn")

    //#given dwfinance-style prose-only design doc (zero tasks) with completed status
    const dw = resolvePlanCompletion(DWFINANCE_ZERO, { status: "completed" })

    //#when + then triage never reports complete
    expect(dw.checkbox.needsTriage).toBe(true)
    expect(dw.verdict).not.toBe("complete")
    expect(dw.verdict).toBe("mismatch-warn")
  })

  test("null status yields incomplete or mismatch, never complete", () => {
    //#given no front-matter
    const result = resolvePlanCompletion(ALL_DONE, null)

    //#when + then
    expect(result.status).toBeNull()
    expect(result.verdict).not.toBe("complete")
  })

  test("forceCompletion claim with completed status still warns, never forces", () => {
    //#given open boxes claiming completed plus a stale forceCompletion claim
    const content = PART_DONE
    const claimed = { status: "completed", forceCompletion: true }

    //#when resolving with the dead front-matter path
    const result = resolvePlanCompletion(content, claimed)

    //#then the claim is ignored: mismatch-warn, never forced complete
    expect(result.verdict).toBe("mismatch-warn")
    expect(result.verdict).not.toBe("complete")
  })
})
