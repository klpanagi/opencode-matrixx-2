import { describe, expect, it } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { getLastAssistant } from "../../../src/hooks/context-window-limit-recovery"
import { createDynamicTruncator } from "../../../src/shared/dynamic-truncator"

type Client = Parameters<typeof getLastAssistant>[1]
type TruncatorCtx = Parameters<typeof createDynamicTruncator>[0]

function createClient(messagesResponse: unknown): Client {
  return {
    session: { context: async () => messagesResponse },
  } as unknown as Client
}

function createCtx(messagesResponse: unknown): TruncatorCtx {
  return {
    session: { context: async () => messagesResponse },
  } as unknown as TruncatorCtx
}

describe("context-window-limit-recovery golden (flat V2 messages)", () => {
  it("finds the last assistant message in a flat V2 transcript", async () => {
    // given a flat V2 transcript wrapped in the SDK data envelope
    const client = createClient(loadCorpus("v2-flat"))

    // when locating the last assistant message
    const assistant = await getLastAssistant("ses_golden", client, "/tmp/golden")

    // then the newest assistant message is returned as the flat message itself
    expect(assistant?.id).toBe("msg_v2_asst_2")
  })

  it("derives no context-window usage from a flat V2 transcript", async () => {
    // given a flat V2 transcript served by the session client
    const truncator = createDynamicTruncator(createCtx({ messages: loadCorpus("v2-flat") }))

    // when deriving token usage
    const usage = await truncator.getUsage("ses_golden")

    // then usage is unknown, so truncation falls back to the static limit
    expect(usage).toBeNull()
  })

  it("passes a short output through untouched when usage is unknown", async () => {
    // given a flat V2 transcript and a short output
    const truncator = createDynamicTruncator(createCtx({ messages: loadCorpus("v2-flat") }))
    const output = "line one\nline two\nline three"

    // when truncating against the session
    const truncated = await truncator.truncate("ses_golden", output)

    // then the fallback static limit leaves the payload unchanged and reports no truncation
    expect(truncated).toEqual({ result: output, truncated: false })
  })

  it("finds no assistant message in a V1-shaped transcript", async () => {
    // given a V1-shaped transcript wrapped in the SDK data envelope
    const client = createClient(loadCorpus("v1-shaped"))

    // when locating the last assistant message
    const assistant = await getLastAssistant("ses_contract", client, "/tmp/golden")

    // then nothing is found, because the reader now speaks the flat shape only
    expect(assistant).toBeNull()
  })
})
