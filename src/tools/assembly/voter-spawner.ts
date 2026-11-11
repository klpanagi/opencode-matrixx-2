import {
  type NativeSubagentClient,
  spawnNativeSubagent,
  waitNativeSubagent,
} from "../../shared/session/native-subagent"
import { POLL_INTERVAL_MS, VOTER_TIMEOUT_MS } from "./constants"
import type { ProviderModel, VoterResult } from "./types"

export interface SpawnVotersOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  signal?: AbortSignal
}

export async function spawnVoters(
  client: NativeSubagentClient,
  question: string,
  providers: ProviderModel[],
  parentSessionID: string,
  options?: SpawnVotersOptions,
): Promise<VoterResult[]> {
  const timeoutMs = options?.timeoutMs ?? VOTER_TIMEOUT_MS
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS

  const spawns = await Promise.all(
    providers.map((provider, index) =>
      spawnNativeSubagent(client, {
        agent: "mouse",
        model: {
          providerID: provider.providerID,
          modelID: provider.modelID,
          temperature: 0.3,
        },
        prompt: `You are voter #${index + 1} in a multi-model assembly process. Analyze the following question independently and provide your reasoning. Be thorough and consider multiple angles.

Question: ${question}

Output your analysis in this format:
## Reasoning
[Your detailed step-by-step reasoning]

## Conclusion
[Your final answer/conclusion]

## Confidence
[High/Medium/Low - with justification]`,
        parentSessionID,
        title: `assembly-voter-${provider.providerID}-${index + 1}`,
      }),
    ),
  )

  return Promise.all(
    spawns.map(async (spawn, index) => {
      const provider = providers[index]
      if (!spawn.ok) {
        return {
          voterIndex: index,
          modelLabel: `${provider.providerID}:${provider.modelID}`,
          reasoning: "",
          status: "error" as const,
          error: spawn.error,
        }
      }

      const waited = await waitNativeSubagent(client, {
        sessionID: spawn.sessionID,
        timeoutMs,
        pollIntervalMs,
        signal: options?.signal,
      })

      if (waited.status === "completed") {
        return {
          voterIndex: index,
          modelLabel: `${provider.providerID}:${provider.modelID}`,
          reasoning: waited.output ?? "",
          status: "completed" as const,
        }
      }

      if (waited.status === "timeout") {
        return {
          voterIndex: index,
          modelLabel: `${provider.providerID}:${provider.modelID}`,
          reasoning: "",
          status: "timeout" as const,
          error: `Voter ${index + 1} timed out after ${timeoutMs}ms`,
        }
      }

      return {
        voterIndex: index,
        modelLabel: `${provider.providerID}:${provider.modelID}`,
        reasoning: "",
        status: "error" as const,
        error: `Voter ${index + 1} was ${waited.error ?? "failed"}`,
      }
    }),
  )
}
