import { describe, expect, it } from "bun:test"
import {
  contentOf,
  finishOf,
  idOf,
  isAssistant,
  roleOf,
  textOf,
  timeOf,
} from "../../src/shared/session-message"
import { loadCorpus } from "../fixtures/messages/loader"

const malformed: Array<[string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["a string", "nonsense"],
  ["an empty object", {}],
  ["a content-only element", { content: [{ type: "text", text: "content only" }] }],
  ["a text-only element", { type: "user", text: "text only" }],
  ["a number", 42],
]

const accessors: Array<{ name: string; call: (input: unknown) => unknown; hasFallbackType: (value: unknown) => boolean }> = [
  { name: "roleOf", call: roleOf, hasFallbackType: (value) => typeof value === "string" && value.length > 0 },
  { name: "textOf", call: textOf, hasFallbackType: (value) => typeof value === "string" },
  { name: "contentOf", call: contentOf, hasFallbackType: (value) => Array.isArray(value) },
  { name: "finishOf", call: finishOf, hasFallbackType: (value) => value === undefined || typeof value === "string" },
  { name: "idOf", call: idOf, hasFallbackType: (value) => value === undefined || typeof value === "string" },
  { name: "timeOf", call: timeOf, hasFallbackType: (value) => typeof value === "number" },
  { name: "isAssistant", call: isAssistant, hasFallbackType: (value) => typeof value === "boolean" },
]

for (const accessor of accessors) {
  for (const [label, input] of malformed) {
    describe(accessor.name, () => {
      it("returns a defined fallback for " + label, () => {
        // given malformed input
        // when the accessor runs
        const value = accessor.call(input)

        // then it does not throw and the fallback has the documented type
        expect(accessor.hasFallbackType(value)).toBe(true)
      })
    })
  }
}

describe("session-message fallbacks", () => {
  it("uses the documented empty values for a missing message", () => {
    // given no message at all
    // when each accessor runs
    // then each returns its documented empty value
    expect(roleOf(null)).toBe("unknown")
    expect(textOf(null)).toBe("")
    expect(contentOf(null)).toEqual([])
    expect(finishOf(null)).toBeUndefined()
    expect(idOf(null)).toBeUndefined()
    expect(timeOf(null)).toBe(0)
    expect(isAssistant(null)).toBe(false)
  })
})

describe("session-message over the flat V2 corpus", () => {
  const corpus = loadCorpus("v2-flat")

  it("reads the role from the flat type field", () => {
    // given the corpus
    // when roles are read
    // then user and assistant both resolve
    expect(roleOf(corpus[0])).toBe("user")
    expect(roleOf(corpus[1])).toBe("assistant")
  })

  it("reads user text from the flat text field", () => {
    // given a user message
    // when text is read
    // then the prompt text is returned
    expect(textOf(corpus[0])).toBe("Summarize the failing test.")
  })

  it("joins assistant text from the content array", () => {
    // given an assistant message
    // when text is read
    // then the single text block is returned
    expect(textOf(corpus[1])).toBe("The assertion compares 1 to 2.")
  })

  it("exposes id, time and finish", () => {
    // given assistant messages carrying metadata
    // when metadata is read
    // then id, timestamp and finish survive
    expect(idOf(corpus[3])).toBe("msg_v2_asst_2")
    expect(timeOf(corpus[2])).toBe(1730000002000)
    expect(finishOf(corpus[1])).toBe("stop")
  })

  it("exposes content and identifies the assistant", () => {
    // given the corpus
    // when content and role are inspected
    // then content is the flat array and only assistant messages match
    expect(contentOf(corpus[1]).length).toBe(1)
    expect(isAssistant(corpus[1])).toBe(true)
    expect(isAssistant(corpus[0])).toBe(false)
  })

  it("returns no id, finish or timestamp when they are absent", () => {
    // given an element with only a type
    // when metadata is read
    // then every optional accessor falls back
    const bare = { type: "user" }
    expect(idOf(bare)).toBeUndefined()
    expect(finishOf(bare)).toBeUndefined()
    expect(timeOf(bare)).toBe(0)
  })
})

describe("session-message text extraction", () => {
  it("skips a tool block and keeps the assistant text", () => {
    // given the assistant message that ran a tool
    const corpus = loadCorpus("v2-assistant-tool")

    // when text is read
    // then only the text block is returned
    expect(textOf(corpus[1])).toBe("The suite passes.")
  })

  it("joins text and reasoning blocks in order", () => {
    // given an assistant message with text, reasoning and another text block
    const message = {
      type: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "reasoning", text: "second" },
        { type: "tool", id: "call_1" },
        { type: "text", text: "third" },
      ],
    }

    // when text is read
    // then the readable blocks are joined with newlines
    expect(textOf(message)).toBe("first\nsecond\nthird")
  })

  it("keeps a non-assistant text field verbatim", () => {
    // given a system message with both a text field and content
    const message = { type: "system", text: "system prompt", content: [{ type: "text", text: "ignored" }] }

    // when text is read
    // then the flat text field wins
    expect(textOf(message)).toBe("system prompt")
  })
})

describe("session-message has no V1 fallback", () => {
  it("reports an unknown role and no text for a V1-shaped message", () => {
    // given a V1 shaped element carrying info and parts
    const v1 = loadCorpus("v1-shaped")[1]

    // when the accessors run
    // then nothing is recovered through the old shape
    expect(roleOf(v1)).toBe("unknown")
    expect(textOf(v1)).toBe("")
    expect(contentOf(v1)).toEqual([])
    expect(idOf(v1)).toBeUndefined()
  })
})
