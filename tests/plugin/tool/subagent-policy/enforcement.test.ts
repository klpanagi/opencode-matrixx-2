/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { SOFTWARE_DEV_ENFORCEMENT_MARKER } from "../../../../src/hooks/software-dev-enforcement/constants"
import { applySubagentEnforcement } from "../../../../src/plugin/tool/subagent-policy/enforcement"

function fakeEnforcement(content: string | undefined) {
  return (_agent: unknown, _category: unknown, _skills: unknown, _opts: unknown) => ({
    content,
    error: null,
  })
}

const CODE_PROMPT = "Implement the failing test for src/foo.ts then refactor."

describe("applySubagentEnforcement", () => {
  test("mouse-source code prompt gets enforcement prepended", () => {
    //#given
    const args: Record<string, unknown> = { agent: "mouse-source", prompt: CODE_PROMPT }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement("<ENF/>"))

    //#then
    expect(applied).toBe(true)
    expect(args.prompt).toBe(
      `<system-reminder>${SOFTWARE_DEV_ENFORCEMENT_MARKER}\n<ENF/></system-reminder>\n${CODE_PROMPT}`,
    )
  })

  test("non-code prompt is untouched (isCodeWritingPrompt gate)", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "Summarize the quarterly report highlights.",
    }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement("<ENF/>"))

    //#then
    expect(applied).toBe(false)
    expect(args.prompt).toBe("Summarize the quarterly report highlights.")
  })

  test("non-code-writing worker (mouse-construct) is untouched", () => {
    //#given
    const args: Record<string, unknown> = { agent: "mouse-construct", prompt: CODE_PROMPT }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement("<ENF/>"))

    //#then
    expect(applied).toBe(false)
    expect(args.prompt).toBe(CODE_PROMPT)
  })

  test("plain mouse agent is untouched (existing hook owns mouse/sati)", () => {
    //#given
    const args: Record<string, unknown> = { agent: "mouse", prompt: CODE_PROMPT }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement("<ENF/>"))

    //#then
    expect(applied).toBe(false)
    expect(args.prompt).toBe(CODE_PROMPT)
  })

  test("existing marker prevents double-apply", () => {
    //#given
    const prompt = `<system-reminder>${SOFTWARE_DEV_ENFORCEMENT_MARKER}\n<ENF/></system-reminder>\n${CODE_PROMPT}`
    const args: Record<string, unknown> = { agent: "mouse-source", prompt }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement("<ENF/>"))

    //#then
    expect(applied).toBe(false)
    expect(args.prompt).toBe(prompt)
  })

  test("no enforcement content means no mutation", () => {
    //#given
    const args: Record<string, unknown> = { agent: "mouse-source", prompt: CODE_PROMPT }

    //#when
    const applied = applySubagentEnforcement(args, [], fakeEnforcement(undefined))

    //#then
    expect(applied).toBe(false)
    expect(args.prompt).toBe(CODE_PROMPT)
  })
})
