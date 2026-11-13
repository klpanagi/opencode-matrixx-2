/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createOperatorAgent } from "../../src/agents/definitions/operator"

function operatorSystemPrompt(): string {
  return String(createOperatorAgent("claude-haiku-4-5").system)
}

function phase05Section(): string {
  const system = operatorSystemPrompt()
  const start = system.indexOf("PHASE 0.5")
  const end = system.indexOf("PHASE 1", start)
  return system.slice(start, end)
}

describe("operator docs discovery ordering", () => {
  test("Phase 0.5 calls context7 before websearch", () => {
    //#given the operator documentation-discovery phase
    const section = phase05Section()

    //#when locating the context7 and websearch steps
    const context7Index = section.indexOf("context7_resolve-library-id")
    const websearchIndex = section.indexOf("websearch(")

    //#then context7 resolution is the first action and websearch is the fallback
    expect(context7Index).toBeGreaterThan(-1)
    expect(websearchIndex).toBeGreaterThan(-1)
    expect(context7Index).toBeLessThan(websearchIndex)
    expect(section).toContain("context7_query-docs")
  })

  test("operator prompt never references the non-existent context7_get-library-docs", () => {
    //#given the full operator system prompt
    const system = operatorSystemPrompt()

    //#when scanning for stale tool names
    //#then the removed tool is absent
    expect(system).not.toContain("context7_get-library-docs")
  })

  test("implementation-reference flow uses canonical context7_query-docs", () => {
    //#given the full operator system prompt
    const system = operatorSystemPrompt()

    //#when inspecting the parallel acceleration example
    //#then it references the registered context7 tool
    expect(system).toContain("context7_query-docs(")
  })
})
