/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { synthesizeResults } from "../../../src/tools/assembly/synthesizer"
import type { VoterResult } from "../../../src/tools/assembly/types"
import { assistantMessage, createFakeAssemblyClient, userMessage } from "./fake-client"

const VOTERS: VoterResult[] = [
  { voterIndex: 0, modelLabel: "anthropic:m1", reasoning: "r1", status: "completed" },
  { voterIndex: 1, modelLabel: "openai:m2", reasoning: "r2", status: "completed" },
]

const SYNTHESIS_TEXT = `## Consensus
Ship it.

## Confidence Level
High - strong agreement.

## Key Agreements
- Point A

## Key Disagreements
- Nothing major
`

describe("synthesizeResults", () => {
  test("parses consensus and confidence from the completed synthesis", async () => {
    //#given
    const { client, calls } = createFakeAssemblyClient([[userMessage(), assistantMessage(SYNTHESIS_TEXT)]])

    //#when
    const result = await synthesizeResults(client, "q?", VOTERS, 1, "parent-1")

    //#then
    expect(result.round).toBe(1)
    expect(result.consensus).toContain("Ship it.")
    expect(result.confidence).toBe("high")
    expect(result.disagreements).toEqual(["Nothing major"])
    expect(calls.create).toHaveLength(1)
    const body = calls.create[0]
    expect(body.agent).toBe("mouse")
    expect(body.title).toBe("assembly-synthesizer-round-1")
  })

  test("falls back to timeout consensus when the synthesis hangs", async () => {
    //#given
    const { client } = createFakeAssemblyClient([[userMessage()]])

    //#when
    const result = await synthesizeResults(client, "q?", VOTERS, 2, "parent-1", {
      timeoutMs: 40,
      pollIntervalMs: 5,
    })

    //#then
    expect(result.consensus).toBe("Synthesis timed out")
    expect(result.confidence).toBe("low")
    expect(result.disagreements).toEqual(["anthropic:m1", "openai:m2"])
  })

  test("falls back to failure consensus when the synthesis errors", async () => {
    //#given
    const { client } = createFakeAssemblyClient([
      [userMessage(), { ...assistantMessage(""), error: "boom", finish: "error" }],
    ])

    //#when
    const result = await synthesizeResults(client, "q?", VOTERS, 1, "parent-1")

    //#then
    expect(result.consensus).toBe("Synthesis failed: boom")
    expect(result.confidence).toBe("low")
  })
})
