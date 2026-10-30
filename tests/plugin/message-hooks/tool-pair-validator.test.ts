/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { V2SessionContextEvent } from "../../../src/plugin/context"
import type { FlatMessage } from "../../../src/plugin/message-hooks/tool-pair-validator"
import {
  handleToolPairValidatorEvent,
  repairToolPairMessages,
} from "../../../src/plugin/message-hooks/tool-pair-validator"

const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)"

type TestBlock = {
  type: string
  id?: string
  callID?: string
  tool_use_id?: string
  content?: string
  text?: string
}

type TestMessage = { role: "assistant" | "user"; content: TestBlock[]; [key: string]: unknown }

async function runRepair(messages: TestMessage[]): Promise<void> {
  //#given a flat session event carrying the messages
  const event = { messages } as unknown as V2SessionContextEvent
  //#when the flat validator entry point runs (same body for context + generate)
  await handleToolPairValidatorEvent(event)
}

describe("toolPairValidator flat port — same transformation as the V1 hook", () => {
  test("leaves matching tool pairs unchanged (AssistantTool callID)", async () => {
    //#given an assistant AssistantTool block with its matching result
    const messages = [
      { role: "assistant", content: [{ type: "tool", callID: "call_1" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
    ] satisfies TestMessage[]

    //#when
    await runRepair(messages)

    //#then nothing changes
    expect(messages).toEqual([
      { role: "assistant", content: [{ type: "tool", callID: "call_1" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }] },
    ])
  })

  test("injects a missing tool_result into the next user message", async () => {
    //#given an assistant tool_use whose result is missing from the user message
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1" }] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ] satisfies TestMessage[]

    //#when
    await runRepair(messages)

    //#then the placeholder result is inserted before the text block
    expect(messages[1]?.content as unknown).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER },
      { type: "text", text: "continue" },
    ])
  })

  test("injects a synthetic user message when the next user message is missing", async () => {
    //#given a lone assistant message with two tool calls
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1" },
          { type: "text", text: "working" },
          { type: "tool_use", id: "toolu_2" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runRepair(messages)

    //#then a synthetic user message carries both placeholder results
    expect(messages as unknown).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1" },
          { type: "text", text: "working" },
          { type: "tool_use", id: "toolu_2" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER },
          { type: "tool_result", tool_use_id: "toolu_2", content: TOOL_RESULT_PLACEHOLDER },
        ],
      },
    ])
  })

  test("injects a synthetic user message before a non-user next message", async () => {
    //#given an assistant tool call followed by another assistant message
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1" }] },
      { role: "assistant", content: [{ type: "text", text: "follow-up" }] },
    ] satisfies TestMessage[]

    //#when
    await runRepair(messages)

    //#then the synthetic user message lands between them
    expect(messages).toHaveLength(3)
    expect(messages as unknown).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1" }] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER }],
      },
      { role: "assistant", content: [{ type: "text", text: "follow-up" }] },
    ])
  })

  test("injects only the missing tool_results for partial matches", async () => {
    //#given mixed tool_use + AssistantTool calls with one result already present
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1" }, { type: "tool", callID: "call_2" }],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "done" },
          { type: "text", text: "continue" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runRepair(messages)

    //#then only the missing AssistantTool result is inserted
    expect(messages[1]?.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "done" },
      { type: "tool_result", tool_use_id: "call_2", content: TOOL_RESULT_PLACEHOLDER },
      { type: "text", text: "continue" },
    ])
  })

  test("propagates sessionID into the synthetic user message", async () => {
    //#given an assistant message carrying a sessionID and no follower
    const messages = [{ role: "assistant", sessionID: "ses_1", content: [{ type: "tool_use", id: "toolu_9" }] }] as unknown as TestMessage[]

    //#when
    await runRepair(messages)

    //#then the synthetic user message keeps the session affinity
    expect(messages).toHaveLength(2)
    expect((messages[1] as { sessionID?: string }).sessionID).toBe("ses_1")
  })
})

describe("toolPairValidator flat port — negative + generate-path controls", () => {
  test("empty messages array is a silent no-op", async () => {
    //#given no messages at all
    const messages: FlatMessage[] = []
    //#when the repair runs
    repairToolPairMessages(messages)
    //#then nothing throws and nothing is added
    expect(messages).toEqual([])
  })

  test("assistant message with content: [] does not crash", async () => {
    //#given an assistant message with an empty content array
    const messages: FlatMessage[] = [{ role: "assistant", content: [] }]
    //#when the repair runs
    repairToolPairMessages(messages)
    //#then the transcript is untouched and nothing throws
    expect(messages).toEqual([{ role: "assistant", content: [] }])
  })

  test("message without a content array does not crash", async () => {
    //#given an assistant message carrying no content array at all
    const messages: FlatMessage[] = [{ role: "assistant" }]
    //#when the repair runs
    repairToolPairMessages(messages)
    //#then nothing throws and no synthetic message is invented
    expect(messages).toEqual([{ role: "assistant" }])
  })

  test("event without messages is a silent no-op", async () => {
    //#given a session event with no messages array
    const event = {} as unknown as V2SessionContextEvent
    //#when the entry point runs
    await handleToolPairValidatorEvent(event)
    //#then nothing throws
    expect(event).toEqual({})
  })

  test("generate-kind event repairs pairs exactly like a context event", async () => {
    //#given an auxiliary-request payload (generate bypasses context)
    const contextMessages = [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1" }] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ] satisfies TestMessage[]
    const generateMessages = structuredClone(contextMessages) as TestMessage[]
    //#when both entry points run (one body serves both registrations)
    await runRepair(contextMessages)
    await handleToolPairValidatorEvent({ messages: generateMessages } as unknown as V2SessionContextEvent)
    //#then both transcripts repair identically
    expect(generateMessages).toEqual(contextMessages)
    expect(generateMessages[1]?.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: TOOL_RESULT_PLACEHOLDER },
      { type: "text", text: "continue" },
    ])
  })
})