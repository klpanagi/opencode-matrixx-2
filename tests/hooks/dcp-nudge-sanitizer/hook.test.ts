/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
/**
 * Local legacy `{info, parts}` shapes (Task 27: the V1 `experimental.chat.messages.transform`
 * fan-out is deleted, so `legacy V1 SDK` message types are no longer imported).
 * The live native port operates on flat `Message[]` in `src/plugin/message-hooks/`.
 */
type Message = {
  id?: string
  sessionID?: string
  role?: string
  [key: string]: unknown
}
type Part = {
  type?: string
  text?: string
  [key: string]: unknown
}

import type { MatrixxContext } from "../../../src/plugin/context"
import { createDcpNudgeSanitizerHook } from "../../../src/hooks/dcp-nudge-sanitizer/hook"

type MessageWithParts = { info: Message; parts: Part[] }

function makeMessage(role: "user" | "assistant", id: string): MessageWithParts {
  return {
    info: { id, sessionID: "ses_sanitize", role, time: { created: 0 } } as Message,
    parts: [],
  }
}

function textPart(text: string): Part {
  return { type: "text", text } as unknown as Part
}

function getText(part: Part): string {
  return (part as { text?: string }).text ?? ""
}

function countNudges(parts: Part[]): number {
  return parts.filter((part) => getText(part).includes("<instruction name=iteration_nudge>")).length
}

const NUDGE = "<instruction name=iteration_nudge>use the compress tool on it now</instruction>"

async function runSanitizer(messages: MessageWithParts[]): Promise<MessageWithParts[]> {
  const hook = createDcpNudgeSanitizerHook({} as MatrixxContext)
  await hook["experimental.chat.messages.transform"]?.({} as Record<string, never>, { messages })
  return messages
}

describe("createDcpNudgeSanitizerHook — dedupe and cap sticky nudges", () => {
  test("keeps at most one nudge part per message", async () => {
    //#given
    const message = makeMessage("assistant", "msg_1")
    message.parts = [
      textPart("real assistant answer"),
      textPart(NUDGE),
      textPart(NUDGE),
      textPart(NUDGE),
    ]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(2)
    expect(getText(message.parts[0])).toBe("real assistant answer")
    const kept = getText(message.parts[1])
    expect(kept).toContain("use the compress tool on it now")
    expect(kept).not.toContain("iteration_nudge")
    expect(kept).toContain("state that explicitly and continue")
  })

  test("caps nudges globally across the transcript", async () => {
    //#given
    const first = makeMessage("assistant", "msg_1")
    first.parts = [textPart(NUDGE)]
    const second = makeMessage("assistant", "msg_2")
    second.parts = [textPart(NUDGE), textPart("tail")]

    //#when
    await runSanitizer([first, second])

    //#then
    expect(first.parts.length).toBe(1)
    expect(getText(first.parts[0])).toContain("use the compress tool on it now")
    expect(second.parts.length).toBe(1)
    expect(getText(second.parts[0])).toBe("tail")
  })

  test("leaves messages without nudges untouched", async () => {
    //#given
    const message = makeMessage("user", "msg_1")
    message.parts = [textPart("hello"), textPart("world")]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(2)
    expect(getText(message.parts[0])).toBe("hello")
    expect(getText(message.parts[1])).toBe("world")
  })

  test("recognizes compressed-block markers and trims the kept part", async () => {
    //#given
    const message = makeMessage("assistant", "msg_1")
    message.parts = [
      textPart("  Compressed block context: prior summary (b2)  "),
      textPart("Compressed block context: duplicate (b3)"),
    ]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(1)
    expect(getText(message.parts[0])).toBe("Compressed block context: prior summary (b2)")
  })

  test("does not delete non-text parts", async () => {
    //#given
    const message = makeMessage("assistant", "msg_1")
    message.parts = [
      { type: "tool_use", id: "call_1" } as unknown as Part,
      textPart(NUDGE),
      textPart(NUDGE),
    ]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(2)
    expect((message.parts[0] as { type: string }).type).toBe("tool_use")
    expect(getText(message.parts[1])).toContain("use the compress tool on it now")
  })

  test("appends availability guard to unconditional compress orders", async () => {
    //#given
    const message = makeMessage("assistant", "msg_1")
    message.parts = [
      textPart("<instruction name=iteration_nudge>You MUST use the `compress` tool now. Start from older history.</instruction>"),
    ]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(1)
    const kept = getText(message.parts[0])
    expect(kept).toContain("`compress` tool")
    expect(kept).toContain("state that explicitly and continue")
  })

  test("leaves already-conditional compress guidance untouched", async () => {
    //#given
    const conditional = "<instruction name=iteration_nudge>If your session exposes a `compress` tool, use it when context is low.</instruction>"
    const message = makeMessage("assistant", "msg_1")
    message.parts = [textPart(conditional)]

    //#when
    await runSanitizer([message])

    //#then
    expect(message.parts.length).toBe(1)
    expect(getText(message.parts[0])).toBe(
      "If your session exposes a `compress` tool, use it when context is low.",
    )
  })
})
