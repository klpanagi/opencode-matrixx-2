import {
  type NativeSubagentClient,
  spawnNativeSubagent,
  waitNativeSubagent,
} from "../../shared/session/native-subagent"
import { POLL_INTERVAL_MS } from "./constants"
import type { SynthesisResult, VoterResult } from "./types"

export interface SynthesizeOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  signal?: AbortSignal
}

const SYNTHESIS_TIMEOUT_MS = 120_000

export async function synthesizeResults(
  client: NativeSubagentClient,
  question: string,
  voterResults: VoterResult[],
  round: number,
  parentSessionID: string,
  options?: SynthesizeOptions,
): Promise<SynthesisResult> {
  const timeoutMs = options?.timeoutMs ?? SYNTHESIS_TIMEOUT_MS
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS

  const voterContext = voterResults
    .map(
      (v, i) => `--- Voter ${i + 1} (${v.modelLabel}) ---
Status: ${v.status}
${v.status === "completed" ? v.reasoning : `Error: ${v.error}`}`,
    )
    .join("\n\n")

  const synthesisPrompt = `You are the synthesis agent. Multiple AI voters have independently analyzed a question. Your task is to synthesize their reasoning into a unified consensus.

## Question
${question}

## Voter Analyses
${voterContext}

## Synthesis Round
This is round #${round}.

## Your Task
1. Identify points of agreement across all voters
2. Identify points of disagreement or divergence
3. Weigh the strength of evidence and reasoning from each
4. Produce a unified consensus with confidence level

## Output Format
## Consensus
[Your unified answer/conclusion]

## Confidence Level
[High/Medium/Low - with rationale]

## Key Agreements
- [Point 1]
- [Point 2]

## Key Disagreements
- [Point 1]
- [Point 2]
`

  const spawn = await spawnNativeSubagent(client, {
    agent: "mouse",
    model: {
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      temperature: 0.1,
    },
    prompt: synthesisPrompt,
    parentSessionID,
    title: `assembly-synthesizer-round-${round}`,
  })

  if (!spawn.ok) {
    return {
      round,
      consensus: `Synthesis failed: ${spawn.error}`,
      confidence: "low",
      disagreements: voterResults.filter((v) => v.status === "completed").map((v) => v.modelLabel),
    }
  }

  const waited = await waitNativeSubagent(client, {
    sessionID: spawn.sessionID,
    timeoutMs,
    pollIntervalMs,
    signal: options?.signal,
  })

  if (waited.status === "completed") {
    return parseSynthesis(waited.output ?? "", round)
  }

  if (waited.status === "timeout") {
    return {
      round,
      consensus: "Synthesis timed out",
      confidence: "low",
      disagreements: voterResults.filter((v) => v.status === "completed").map((v) => v.modelLabel),
    }
  }

  return {
    round,
    consensus: `Synthesis failed: ${waited.error ?? "Unknown"}`,
    confidence: "low",
    disagreements: voterResults.filter((v) => v.status === "completed").map((v) => v.modelLabel),
  }
}

function parseSynthesis(text: string, round: number): SynthesisResult {
  const confidenceMatch = text.match(/## Confidence Level\s*\n([^\n]+)/)
  const confidenceRaw = (confidenceMatch?.[1] ?? "medium").toLowerCase()
  const confidence =
    confidenceRaw.includes("high")
      ? ("high" as const)
      : confidenceRaw.includes("low")
        ? ("low" as const)
        : ("medium" as const)

  const consensusMatch = text.match(/## Consensus\s*\n([\s\S]*?)(?=\n## Confidence Level|\n## Key Agreements|\n$)/)
  const consensus = consensusMatch?.[1]?.trim() ?? text

  const disagreements: string[] = []
  const disagreementsMatch = text.match(/## Key Disagreements\s*\n([\s\S]*?)(?=\n## |$)/)
  if (disagreementsMatch) {
    const lines = disagreementsMatch[1].trim().split("\n")
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim()
      if (trimmed) disagreements.push(trimmed)
    }
  }

  return { round, consensus, confidence, disagreements }
}
