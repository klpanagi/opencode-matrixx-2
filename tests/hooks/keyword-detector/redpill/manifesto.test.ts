import { describe, expect, test } from "bun:test"
import { REDPILL_DEEPSEEK_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/deepseek"
import { REDPILL_DEFAULT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/default"
import { REDPILL_GEMINI_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gemini"
import { REDPILL_GLM_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/glm"
import { REDPILL_GPT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gpt5.2"
import { getPlannerRedpillMessage } from "../../../../src/hooks/keyword-detector/redpill/planner"
import { REDPILL_MIMO_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/mimo"

const VARIANTS = [
  { name: "default", message: REDPILL_DEFAULT_MESSAGE },
  { name: "deepseek", message: REDPILL_DEEPSEEK_MESSAGE },
  { name: "gemini", message: REDPILL_GEMINI_MESSAGE },
  { name: "glm", message: REDPILL_GLM_MESSAGE },
  { name: "gpt5.2", message: REDPILL_GPT_MESSAGE },
  { name: "mimo", message: REDPILL_MIMO_MESSAGE },
]

describe("Matrixx manifesto", () => {
  test.each(VARIANTS)("$name carries the shared doctrine", ({ message }) => {
    //#given a model variant composed from the shared manifesto
    //#when the injected message is generated
    //#then it carries the activation, scientific attribution, and evidence contract
    expect(message).toContain("MATRIXX ONLINE — RED PILL ACCEPTED")
    expect(message).toContain("A Manifesto for Reproducible Science")
    expect(message).toContain("Reproducible evidence over confident assertion")
    expect(message).toContain("NO EVIDENCE = NOT VERIFIED = NOT DONE")
  })

  test.each(VARIANTS)("$name fully defers from the v1 redpill manifesto", ({ message }) => {
    //#given a model variant that must not inherit the forked v1 text
    //#when the injected message is generated
    //#then none of the legacy manifesto markers survive
    expect(message).not.toContain("REDPILL MODE ENABLED")
    expect(message).not.toContain("[CODE RED]")
    expect(message).not.toContain("Ultrathink before acting")
  })

  test("planner receives the Architect's Oath", () => {
    //#given the planner routing path
    //#when the message is generated
    //#then the planner gets a planning-specific doctrine
    expect(getPlannerRedpillMessage()).toContain("THE ARCHITECT'S OATH")
    expect(getPlannerRedpillMessage()).toContain("MATRIXX ONLINE — RED PILL ACCEPTED")
  })
})
