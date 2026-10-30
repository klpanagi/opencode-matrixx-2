/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { V2SessionContextEvent } from "../../../src/plugin/context"
import type { FlatMessage } from "../../../src/plugin/message-hooks/dcp-nudge-sanitizer"
import {
  handleDcpNudgeSanitizerEvent,
  sanitizeNudgeMessages,
} from "../../../src/plugin/message-hooks/dcp-nudge-sanitizer"

function makeMessage(role: string, id: string): FlatMessage {
  return { id, role, content: [] }
}

function textBlock(text: string): Record<string, unknown> {
  return { type: "text", text }
}

function getText(block: unknown): string {
  return (block as { text?: string }).text ?? ""
}

function countNudges(blocks: unknown[]): number {
  return blocks.filter((block) => getText(block).includes("<instruction name=iteration_nudge>")).length
}

const NUDGE = "<instruction name=iteration_nudge>use the compress tool on it now</instruction>"

async function runSanitizer(messages: FlatMessage[]): Promise<FlatMessage[]> {
  //#given a flat session event carrying the messages
  const event = { messages } as unknown as V2SessionContextEvent
  //#when the flat sanitizer entry point runs
  await handleDcpNudgeSanitizerEvent(event)
  //#then the array was mutated in place
  return messages
}

describe("dcpNudgeSanitizer flat port — same transformation as the V1 hook", () => {
  test("keeps at most one nudge block per message", async () => {
    //#given an assistant message with one answer block and three nudges
    const message = makeMessage("assistant", "msg_1")
    message.content = [
      textBlock("real assistant answer"),
      textBlock(NUDGE),
      textBlock(NUDGE),
      textBlock(NUDGE),
    ]

    //#when
    await runSanitizer([message])

    //#then only the answer and one sanitized nudge survive
    const blocks = message.content as unknown[]
    expect(blocks.length).toBe(2)
    expect(getText(blocks[0])).toBe("real assistant answer")
    const kept = getText(blocks[1])
    expect(kept).toContain("use the compress tool on it now")
    expect(kept).not.toContain("iteration_nudge")
    expect(kept).toContain("state that explicitly and continue")
  })

  test("caps nudges globally across the transcript", async () => {
    //#given two assistant messages each carrying a nudge
    const first = makeMessage("assistant", "msg_1")
    first.content = [textBlock(NUDGE)]
    const second = makeMessage("assistant", "msg_2")
    second.content = [textBlock(NUDGE), textBlock("tail")]

    //#when
    await runSanitizer([first, second])

    //#then the first nudge is kept (sanitized) and the second is dropped
    expect((first.content as unknown[]).length).toBe(1)
    expect(getText((first.content as unknown[])[0])).toContain("use the compress tool on it now")
    expect((second.content as unknown[]).length).toBe(1)
    expect(getText((second.content as unknown[])[0])).toBe("tail")
  })

  test("leaves messages without nudges untouched", async () => {
    //#given a user message with plain text blocks
    const message = makeMessage("user", "msg_1")
    message.content = [textBlock("hello"), textBlock("world")]

    //#when
    await runSanitizer([message])

    //#then nothing changes
    expect(message.content).toEqual([textBlock("hello"), textBlock("world")])
  })

  test("recognizes compressed-block markers and trims the kept block", async () => {
    //#given padded compressed-block prose
    const message = makeMessage("assistant", "msg_1")
    message.content = [
      textBlock("  Compressed block context: prior summary (b2)  "),
      textBlock("Compressed block context: duplicate (b3)"),
    ]

    //#when
    await runSanitizer([message])

    //#then one trimmed block survives
    const blocks = message.content as unknown[]
    expect(blocks.length).toBe(1)
    expect(getText(blocks[0])).toBe("Compressed block context: prior summary (b2)")
  })

  test("does not delete non-text blocks", async () => {
    //#given a tool block followed by two nudges
    const message = makeMessage("assistant", "msg_1")
    message.content = [{ type: "tool_use", id: "call_1" }, textBlock(NUDGE), textBlock(NUDGE)]

    //#when
    await runSanitizer([message])

    //#then the tool block and one sanitized nudge survive
    const blocks = message.content as unknown[]
    expect(blocks.length).toBe(2)
    expect((blocks[0] as { type: string }).type).toBe("tool_use")
    expect(getText(blocks[1])).toContain("use the compress tool on it now")
  })

  test("appends availability guard to unconditional compress orders", async () => {
    //#given a nudge ordering unconditional `compress` tool use
    const message = makeMessage("assistant", "msg_1")
    message.content = [
      textBlock("<instruction name=iteration_nudge>You MUST use the `compress` tool now. Start from older history.</instruction>"),
    ]

    //#when
    await runSanitizer([message])

    //#then the guard is appended to the kept prose
    const blocks = message.content as unknown[]
    expect(blocks.length).toBe(1)
    const kept = getText(blocks[0])
    expect(kept).toContain("`compress` tool")
    expect(kept).toContain("state that explicitly and continue")
  })

  test("leaves already-conditional compress guidance untouched", async () => {
    //#given already-conditional guidance (no guard needed)
    const conditional =
      "<instruction name=iteration_nudge>If your session exposes a `compress` tool, use it when context is low.</instruction>"
    const message = makeMessage("assistant", "msg_1")
    message.content = [textBlock(conditional)]

    //#when
    await runSanitizer([message])

    //#then only the tags are stripped, prose is byte-identical
    const blocks = message.content as unknown[]
    expect(blocks.length).toBe(1)
    expect(getText(blocks[0])).toBe(
      "If your session exposes a `compress` tool, use it when context is low.",
    )
  })
})

describe("dcpNudgeSanitizer flat port — negative controls", () => {
  test("empty messages array is a silent no-op", async () => {
    //#given no messages at all
    const messages: FlatMessage[] = []
    //#when the sanitizer runs
    await runSanitizer(messages)
    //#then nothing throws and nothing is added
    expect(messages).toEqual([])
  })

  test("assistant message with content: [] does not crash", async () => {
    //#given an assistant message with an empty content array
    const message = makeMessage("assistant", "msg_1")
    message.content = []
    //#when the sanitizer runs
    await runSanitizer([message])
    //#then the message is untouched and nothing throws
    expect(message.content).toEqual([])
  })

  test("message without a content array does not crash", async () => {
    //#given a message carrying no content array at all
    const message: FlatMessage = { id: "msg_1", role: "user" }
    //#when the sanitizer runs
    await runSanitizer([message])
    //#then the message is untouched and nothing throws
    expect(message).toEqual({ id: "msg_1", role: "user" })
  })

  test("event without messages is a silent no-op", async () => {
    //#given a session event with no messages array
    const event = {} as unknown as V2SessionContextEvent
    //#when the entry point runs
    await handleDcpNudgeSanitizerEvent(event)
    //#then nothing throws
    expect(event).toEqual({})
  })

  test("sanitized output carries no live nudge markers", async () => {
    //#given a transcript saturated with nudges
    const first = makeMessage("assistant", "msg_1")
    first.content = [textBlock(NUDGE), textBlock(NUDGE)]
    const second = makeMessage("user", "msg_2")
    second.content = [textBlock(NUDGE), textBlock("real question")]
    //#when the sanitizer runs
    sanitizeNudgeMessages([first, second])
    //#then at most one live marker survives across the transcript
    const all = [...(first.content as unknown[]), ...(second.content as unknown[])]
    expect(countNudges(all)).toBeLessThanOrEqual(1)
  })
})