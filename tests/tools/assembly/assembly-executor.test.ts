/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { executeAssembly } from "../../../src/tools/assembly/assembly-executor"
import { assistantMessage, createFakeAssemblyClient, userMessage } from "./fake-client"

function voterTranscript(reasoning: string) {
  return [
    userMessage(),
    assistantMessage(`## Reasoning\n${reasoning}\n\n## Conclusion\nDone\n\n## Confidence\nHigh`),
  ]
}

function synthesisTranscript(confidence: string, consensus: string) {
  return [
    userMessage(),
    assistantMessage(`## Consensus\n${consensus}\n\n## Confidence Level\n${confidence}\n\n## Key Disagreements\n- None\n`),
  ]
}

describe("executeAssembly", () => {
  test("breaks early when the first synthesis reaches high confidence", async () => {
    //#given
    const { client, calls } = createFakeAssemblyClient([
      voterTranscript("r1"),
      voterTranscript("r2"),
      voterTranscript("r3"),
      synthesisTranscript("High", "Final answer"),
      synthesisTranscript("High", "Should not run"),
    ])

    //#when
    const output = await executeAssembly({
      client,
      args: { question: "q?" },
      config: undefined,
      sessionID: "parent-1",
    })

    //#then
    expect(output.voters).toHaveLength(3)
    expect(output.rounds).toHaveLength(1)
    expect(output.finalConsensus).toContain("Final answer")
    expect(output.finalConsensus).toContain("**Confidence**: high")
    expect(calls.create).toHaveLength(4)
  })

  test("runs all rounds when confidence stays low", async () => {
    //#given
    const { client } = createFakeAssemblyClient([
      voterTranscript("r1"),
      synthesisTranscript("Low", "First try"),
      synthesisTranscript("Low", "Second try"),
    ])

    //#when
    const output = await executeAssembly({
      client,
      args: { question: "q?", voters: 1, rounds: 2 },
      config: undefined,
      sessionID: "parent-1",
    })

    //#then
    expect(output.rounds).toHaveLength(2)
    expect(output.finalConsensus).toContain("Second try")
    expect(output.finalConsensus).toContain("**Voters**: 1/1 completed")
  })

  test("reports voter failures in the final consensus", async () => {
    //#given
    const { client } = createFakeAssemblyClient([
      voterTranscript("r1"),
      [userMessage()],
      synthesisTranscript("Medium", "Best effort"),
    ])

    //#when
    const output = await executeAssembly({
      client,
      args: { question: "q?", voters: 2, rounds: 1 },
      config: undefined,
      sessionID: "parent-1",
      timeouts: { timeoutMs: 40, pollIntervalMs: 5 },
    })

    //#then
    expect(output.voters).toHaveLength(2)
    expect(output.finalConsensus).toContain("1/2 completed")
    expect(output.finalConsensus).toContain("timed out after 40ms")
  })
})
