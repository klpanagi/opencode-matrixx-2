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
  it("finds the newest user message in a flat V2 transcript", () => {
    // given a flat V2 transcript where the role lives at the top level
    const messages = loadCorpus("v2-flat") as MessageData[]

    // when scanning backwards for the last user message
    const found = findLastUserMessage(messages)

    // then msg_v2_user_2 is returned
    expect(found?.id).toBe("msg_v2_user_2")
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

  it("reads the resume config from a flat user message that carries agent and model", () => {
    // given a flat user message that carries agent and model at the top level
    const userMessage = {
      id: "msg_contract_user",
      type: "user",
      agent: "oracle",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      text: "continue",
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

  it("recovers a flat V2 tool part by its call id", async () => {
    // given a V2 tool message whose part type is "tool"
    const { client, calls } = createPromptSpy()
    const assistantToolMessage = (loadCorpus("v2-assistant-tool") as MessageData[])[1]

    // when the tool-result-missing recovery runs
    const recovered = await recoverToolResultMissing(client, "ses_golden", assistantToolMessage)

    // then the interrupted tool call is acknowledged once
    expect(recovered).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it("recovers a flat tool_use part without falling back to storage", async () => {
    // given a flat assistant message with one interrupted tool part
    const { client, calls } = createPromptSpy()
    const failedAssistantMsg = {
      id: "msg_contract_assistant",
      type: "assistant",
      content: [{ type: "tool", id: "call_golden", state: { status: "running" } }],
    } as unknown as MessageData

    // when the tool-result-missing recovery runs
    const recovered = await recoverToolResultMissing(client, "ses_golden", failedAssistantMsg)

    // then it prompts the session exactly once to resupply the missing result
    expect(recovered).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
