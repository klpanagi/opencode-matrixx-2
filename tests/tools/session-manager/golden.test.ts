import { describe, expect, it } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { formatSessionList, formatSessionMessages } from "../../../src/tools/session-manager/session-formatter"
import type { SessionMessage } from "../../../src/tools/session-manager/types"

describe("session-manager golden (flat V2 messages)", () => {
  it("cannot format a flat V2 transcript because the parts array moved", () => {
    // given a flat V2 transcript cast to the formatter session-message shape
    const messages = loadCorpus("v2-flat") as unknown as SessionMessage[]

    // when formatting the transcript
    const format = () => formatSessionMessages(messages)

    // then the formatter throws, because each message carries content instead of parts
    // (task 15 flips this expectation to a rendered transcript once accessors land)
    expect(format).toThrow()
  })

  it("reports an empty transcript explicitly", () => {
    // given no messages
    // when formatting
    const rendered = formatSessionMessages([])

    // then the empty marker is returned
    expect(rendered).toBe("No messages found in this session.")
  })

  it("reports an empty session list explicitly", async () => {
    // given no session ids
    // when formatting the list
    const rendered = await formatSessionList([])

    // then the empty marker is returned
    expect(rendered).toBe("No sessions found.")
  })

  it("renders a V1-shaped transcript header and parts (contract kept after accessors)", () => {
    // given a V1-shaped session message with one text part and one tool part
    const messages: SessionMessage[] = [
      {
        id: "msg_contract_assistant",
        role: "assistant",
        agent: "oracle",
        time: { created: 1730000001000 },
        parts: [
          { id: "part_text", type: "text", text: "  hello there  " },
          { id: "part_tool", type: "tool_use", tool: "bash", input: { command: "bun test" } },
        ],
      },
    ]

    // when formatting the transcript
    const rendered = formatSessionMessages(messages)

    // then the header names the role and agent, and each part renders on its own line
    expect(rendered).toContain("[assistant (oracle)]")
    expect(rendered).toContain("hello there")
    expect(rendered).toContain("[tool: bash]")
  })
})
