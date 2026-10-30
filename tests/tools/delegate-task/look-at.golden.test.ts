/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { extractLatestAssistantText } from "../../../src/tools/look-at/assistant-message-extractor"

describe("golden: look-at assistant text extraction", () => {
  test("returns the newest assistant text from the flat corpus", () => {
    //#given the flat corpus, whose newest assistant message is msg_v2_asst_2
    const messages = loadCorpus("v2-flat")

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBe("No, the fixture drifted.")
  })

  test("joins every text part of the chosen message with a newline", () => {
    //#given a corpus whose newest assistant message carries two text parts plus a reasoning part
    const messages = loadCorpus("v2-flat")
    const last = messages[messages.length - 1] as { content: Array<{ type: string; text: string }> }
    last.content = [
      { type: "text", text: "first" },
      { type: "reasoning", text: "ignored" },
      { type: "text", text: "second" },
    ]

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBe("first\nsecond")
  })

  test("returns null when no assistant message is present", () => {
    //#given a corpus of user messages only
    const messages = (loadCorpus("v2-flat") as Array<{ type?: string }>).filter((message) => message.type === "user")

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBeNull()
  })

  test("reads the flat corpus (the gap task 15 closed)", () => {
    //#given the flat corpus that the extractor used to skip
    const v2 = loadCorpus("v2-flat")

    //#when
    const text = extractLatestAssistantText(v2)

    //#then
    expect(text).toBe("No, the fixture drifted.")
  })
})
