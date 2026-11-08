import { describe, expect, test } from "bun:test"
import { REDPILL_DEEPSEEK_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/deepseek"
import { getDefaultRedpillMessage, REDPILL_DEFAULT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/default"
import { REDPILL_GEMINI_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gemini"
import { REDPILL_GLM_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/glm"
import { REDPILL_GPT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gpt5.2"
import {
  composeManifesto,
  MATRIXX_SOFTWARE_DOMAIN_PACK,
  MATRIXX_UNIVERSAL_MANIFESTO,
} from "../../../../src/hooks/keyword-detector/redpill/manifesto"
import { getPlannerRedpillMessage } from "../../../../src/hooks/keyword-detector/redpill/planner"
import { getRedpillMessage } from "../../../../src/hooks/keyword-detector/redpill"
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
    //#then it carries the activation, scientific grounding, and evidence contract
    expect(message).toContain("MATRIXX ONLINE — RED PILL ACCEPTED")
    expect(message).toContain("reproducible-science literature")
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

  test("the universal layer is domain-neutral", () => {
    //#given the layer that applies to ultimate work
    //#when it is inspected
    //#then it carries the values without software-only vocabulary
    expect(MATRIXX_UNIVERSAL_MANIFESTO).toContain("ultimate work")
    expect(MATRIXX_UNIVERSAL_MANIFESTO).toContain("Reproducible evidence over confident assertion")
    expect(MATRIXX_UNIVERSAL_MANIFESTO).toContain("NO EVIDENCE = NOT VERIFIED = NOT DONE")
    expect(MATRIXX_UNIVERSAL_MANIFESTO).not.toContain("TDD Workflow")
    expect(MATRIXX_UNIVERSAL_MANIFESTO).not.toContain("lsp_diagnostics")
    expect(MATRIXX_UNIVERSAL_MANIFESTO).not.toContain("pull request")
  })

  test("the software pack adds software-specific gates", () => {
    //#given the domain pack
    //#when it is inspected
    //#then it carries the TDD pipeline and real software surfaces
    expect(MATRIXX_SOFTWARE_DOMAIN_PACK).toContain("TDD Workflow")
    expect(MATRIXX_SOFTWARE_DOMAIN_PACK).toContain("RED → GREEN → SURFACE → REFACTOR → REGRESSION")
    expect(MATRIXX_SOFTWARE_DOMAIN_PACK).toContain("lsp_diagnostics")
  })

  test("composeManifesto selects the layer", () => {
    //#given the two layers
    //#when they are composed
    //#then the universal body is always present and the software pack is optional
    expect(composeManifesto("universal")).toBe(MATRIXX_UNIVERSAL_MANIFESTO)
    expect(composeManifesto("software")).toContain(MATRIXX_UNIVERSAL_MANIFESTO)
    expect(composeManifesto("software")).toContain(MATRIXX_SOFTWARE_DOMAIN_PACK)
  })

  test("model variants accept a domain", () => {
    //#given a variant that can render either layer
    //#when it is asked for the universal layer
    //#then it must not leak software-only gates
    const universal = getDefaultRedpillMessage("universal")
    const software = getDefaultRedpillMessage("software")
    expect(universal).not.toContain("TDD Workflow")
    expect(software).toContain("TDD Workflow")
  })

  test("runtime routing selects the universal layer for non-software work", () => {
    //#given a prompt with no software signals
    //#when redpill routing runs
    //#then the universal doctrine is injected without software gates
    const universal = getRedpillMessage(undefined, undefined, "write a market analysis report")
    expect(universal).toContain("ultimate work")
    expect(universal).not.toContain("TDD Workflow")
    const software = getRedpillMessage(undefined, undefined, "fix the failing test in src/auth.ts")
    expect(software).toContain("TDD Workflow")
  })

  test("planner receives the Architect's Oath", () => {
    //#given the planner routing path
    //#when the message is generated
    //#then the planner gets a planning-specific doctrine
    expect(getPlannerRedpillMessage()).toContain("THE ARCHITECT'S OATH")
    expect(getPlannerRedpillMessage()).toContain("MATRIXX ONLINE — RED PILL ACCEPTED")
  })
})
