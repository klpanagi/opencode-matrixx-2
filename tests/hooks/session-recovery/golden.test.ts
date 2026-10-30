import { describe, expect, it } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { recoverToolResultMissing } from "../../../src/hooks/session-recovery/recover-tool-result-missing"
import { extractResumeConfig, findLastUserMessage } from "../../../src/hooks/session-recovery/resume"

type MessageData = Parameters<typeof findLastUserMessage>[0][number]
type Client = Parameters<typeof recoverToolResultMissing>[0]

function createPromptSpy(): { client: Client; calls: unknown[] } {
  const calls: unknown[] = []
  const client = {
    session: {
      promptAsync: async (args: unknown) => {
        calls.push(args)
        return {}
      },
    },
  } as unknown as Client
  return { client, calls }
}

describe("session-recovery golden (flat V2 messages)", () => {
  it("finds no user message in a flat V2 transcript", () => {
    // given a flat V2 transcript where the role lives at the top level
    const messages = loadCorpus("v2-flat") as MessageData[]

    // when scanning backwards for the last user message
    const found = findLastUserMessage(messages)

    // then the reader sees nothing, because it only looks at info.role
    // (task 15 flips this expectation to the msg_v2_user_2 id once accessors land)
    expect(found).toBeUndefined()
  })

  it("degrades the resume config to session-only when no user message is found", () => {
    // given a flat V2 transcript and a missing user message
    const messages = loadCorpus("v2-flat") as MessageData[]
    const userMessage = findLastUserMessage(messages)

    // when building the resume config
    const config = extractResumeConfig(userMessage, "ses_golden")

    // then agent and model are both absent
    expect(config).toEqual({ sessionID: "ses_golden", agent: undefined, model: undefined })
  })

  it("reads the resume config from a V1-shaped user message (contract kept after accessors)", () => {
    // given a V1-shaped user message that still carries info.agent and info.model
    const userMessage = {
      info: { role: "user", agent: "oracle", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
      parts: [{ type: "text", text: "continue" }],
    } as unknown as MessageData

    // when building the resume config
    const config = extractResumeConfig(userMessage, "ses_contract")

    // then the agent and model are preserved verbatim
    expect(config).toEqual({
      sessionID: "ses_contract",
      agent: "oracle",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    })
  })

  it("does not recover a flat V2 assistant message that carries no parts", async () => {
    // given a flat V2 assistant message with content instead of parts
    const { client, calls } = createPromptSpy()
    const failedAssistantMsg = (loadCorpus("v2-flat") as MessageData[])[3]

    // when the tool-result-missing recovery runs
    const recovered = await recoverToolResultMissing(client, "ses_golden", failedAssistantMsg)

    // then it reports nothing to recover and never prompts the session
    expect(recovered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it("treats a flat V2 tool part as unrecoverable because it is not a tool_use part", async () => {
    // given a V2 tool message whose part type is "tool" rather than "tool_use"
    const { client, calls } = createPromptSpy()
    const assistantToolMessage = (loadCorpus("v2-assistant-tool") as MessageData[])[1]

    // when the tool-result-missing recovery runs
    const recovered = await recoverToolResultMissing(client, "ses_golden", assistantToolMessage)

    // then the tool_use extractor finds no ids and the session is left untouched
    expect(recovered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it("still recovers a V1-shaped tool_use part (contract kept after accessors)", async () => {
    // given a V1-shaped assistant message with one tool_use part
    const { client, calls } = createPromptSpy()
    const failedAssistantMsg = {
      info: { role: "assistant" },
      parts: [{ type: "tool_use", id: "call_golden" }],
    } as unknown as MessageData

    // when the tool-result-missing recovery runs
    const recovered = await recoverToolResultMissing(client, "ses_golden", failedAssistantMsg)

    // then it prompts the session exactly once to resupply the missing result
    expect(recovered).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
