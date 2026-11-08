import { describe, expect, test } from "bun:test"
import { detectRedpillDomain } from "../../../../src/hooks/keyword-detector/redpill/domain"

describe("detectRedpillDomain", () => {
  test.each([
    ["implement the login feature in src/auth.ts", "software"],
    ["fix the failing test in tests/auth/login.test.ts", "software"],
    ["refactor the API endpoint and run the full suite", "software"],
    ["debug the stack trace from the production server", "software"],
    ["write a market analysis report", "universal"],
    ["draft a strategy memo for the board", "universal"],
    ["summarize this paper and list the limitations", "universal"],
    ["implement a marketing campaign", "universal"],
    ["commit to the plan", "universal"],
    ["the function of this committee", "universal"],
    ["build a team", "universal"],
    ["test the market", "universal"],
  ])("classifies %s as %s", (text, expected) => {
    //#given a redpill prompt with domain-specific vocabulary
    //#when the domain detector runs
    //#then it selects the layer that matches the work
    expect(detectRedpillDomain(text)).toBe(expected)
  })

  test("empty text defaults to the universal layer", () => {
    //#given no prompt context
    //#when the detector runs
    //#then the universal manifesto is the safe default
    expect(detectRedpillDomain("")).toBe("universal")
    expect(detectRedpillDomain("   ")).toBe("universal")
  })

  test("a fenced code block is a software signal", () => {
    //#given a prompt that carries code
    //#when the detector runs
    //#then the software pack is selected
    expect(detectRedpillDomain("review this:\n```ts\nconst x = 1\n```")).toBe("software")
  })
})
