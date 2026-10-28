/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  adjudicate,
  extractStatusEdit,
  type ForceCompletionOptions,
} from "../../../src/tools/plan/status-transition"

function planWithStatus(status: string, body = "- [ ] 1. Do the thing"): string {
  return `---\nstatus: ${status}\nrevision: 1\n---\n# Plan\n\n${body}\n`
}

describe("plan status-transition helpers", () => {
  test("untouched: identical status extracts no transition and adjudicates allow", () => {
    //#given a plan whose proposed content keeps the same status
    const current = planWithStatus("in_progress")
    const next = planWithStatus("in_progress", "- [x] 1. Do the thing")

    //#when extracting the intended transition and adjudicating it
    const transition = extractStatusEdit(current, next)

    //#then there is no transition, so the adjudication allows
    expect(transition).toBeNull()
    expect(adjudicate(transition)).toEqual({ allowed: true })
  })

  test("forward-allow: pending -> completed extracts and adjudicates allow", () => {
    //#given a plan advancing forward from pending to completed
    const current = planWithStatus("pending")
    const next = planWithStatus("completed", "- [x] 1. Do the thing")

    //#when extracting the intended transition and adjudicating it
    const transition = extractStatusEdit(current, next)

    //#then the transition is extracted and allowed without any override
    expect(transition).toEqual({ from: "pending", to: "completed" })
    expect(adjudicate(transition)).toEqual({ allowed: true })
  })

  test("backward-deny: completed -> pending adjudicates reject", () => {
    //#given a plan jumping backward from completed to pending
    const current = planWithStatus("completed", "- [x] 1. Do the thing")
    const next = planWithStatus("pending", "- [x] 1. Do the thing")

    //#when extracting the intended transition and adjudicating without force
    const transition = extractStatusEdit(current, next)
    const options: ForceCompletionOptions = {}

    //#then the transition is extracted and rejected with status_transition_rejected
    expect(transition).toEqual({ from: "completed", to: "pending" })
    expect(adjudicate(transition)).toEqual({
      allowed: false,
      error: "status_transition_rejected",
      from: "completed",
      to: "pending",
    })
    expect(adjudicate(transition, options)).toEqual({
      allowed: false,
      error: "status_transition_rejected",
      from: "completed",
      to: "pending",
    })
  })

  test("force-bypass: backward + forceCompletion:true adjudicates allow", () => {
    //#given a backward jump paired with the explicit human override
    const current = planWithStatus("completed", "- [x] 1. Do the thing")
    const next = planWithStatus("pending", "- [x] 1. Do the thing")
    const options: ForceCompletionOptions = { forceCompletion: true }

    //#when extracting the intended transition and adjudicating with force
    const transition = extractStatusEdit(current, next)

    //#then the override is honored and the transition is allowed
    expect(transition).toEqual({ from: "completed", to: "pending" })
    expect(adjudicate(transition, options)).toEqual({ allowed: true })
  })

  test("body-text ignored: status words outside front-matter extract no transition", () => {
    //#given a plan whose body merely mentions status words (no front-matter change)
    const current = planWithStatus("pending")
    const next = planWithStatus(
      "pending",
      "- [ ] 1. Flip status: completed when done\n\nstatus: completed is the goal",
    )

    //#when extracting the intended transition
    const transition = extractStatusEdit(current, next)

    //#then body prose is ignored and there is no transition
    expect(transition).toBeNull()
    expect(adjudicate(transition)).toEqual({ allowed: true })
  })
})
