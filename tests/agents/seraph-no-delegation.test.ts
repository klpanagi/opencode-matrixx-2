import { describe, expect, test } from "bun:test"
import { SERAPH_SYSTEM_PROMPT } from "../../src/agents/seraph"

describe("seraph no-delegation", () => {
  test("prompt contains no task(subagent_type delegation examples", () => {
    //#given the seraph system prompt with denied task permissions
    //#when scanning for delegation examples
    const hits = SERAPH_SYSTEM_PROMPT.match(/task\(subagent_type/g) ?? []
    //#then no delegation example remains
    expect(hits.length).toBe(0)
  })
  test("prompt states delegation is denied and names direct tools", () => {
    //#given the prompt constraints section
    //#when reading constraints
    //#then it declares NO DELEGATION and direct search tools
    expect(SERAPH_SYSTEM_PROMPT).toContain("NO DELEGATION")
    expect(SERAPH_SYSTEM_PROMPT).toContain("grep")
  })
})
