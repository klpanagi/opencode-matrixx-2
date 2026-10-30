import { describe, expect, test } from "bun:test";

import { applyEnvContextInjector } from "../../../src/hooks/env-context-injector/flat";

type FlatPart = { type?: string; text?: string; [key: string]: unknown };
type FlatMessage = {
  id?: string;
  role?: string;
  type?: string;
  text?: string;
  content?: FlatPart[];
  [key: string]: unknown;
};
type FlatEvent = {
  sessionID?: string;
  messages?: FlatMessage[];
  [key: string]: unknown;
};

function contentUserMessage(id: string, text: string): FlatMessage {
  return { id, role: "user", content: [{ type: "text", text }] };
}

function textFieldUserMessage(id: string, text: string): FlatMessage {
  return { id, type: "user", text };
}

function assistantMessage(id: string, text: string): FlatMessage {
  return { id, role: "assistant", content: [{ type: "text", text }] };
}

describe("envContextInjector flat port (Task 26 Group B)", () => {
  test("appends env block to the last user message content part", async () => {
    //#given a flat turn ending in a user message with content parts
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [
        contentUserMessage("msg_1", "First message"),
        assistantMessage("msg_2", "Response."),
        contentUserMessage("msg_3", "Do something"),
      ],
    };
    //#when applying the flat env-context injection
    await applyEnvContextInjector(event);
    //#then only the last user message carries the env block
    const last = event.messages?.[2];
    expect(last?.content?.[0]?.text).toContain("Do something");
    expect(last?.content?.[0]?.text).toContain("<matrixx-env>");
    expect(event.messages?.[0]?.content?.[0]?.text).not.toContain("<matrixx-env>");
    expect(event.messages?.[1]?.content?.[0]?.text).not.toContain("<matrixx-env>");
  });

  test("appends env block to the text field of a V2 user message", async () => {
    //#given a flat user message carrying text directly (no content array)
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [textFieldUserMessage("msg_1", "Hello")],
    };
    //#when applying the flat env-context injection
    await applyEnvContextInjector(event);
    //#then the text field carries the original plus the env block
    expect(event.messages?.[0]?.text).toContain("Hello");
    expect(event.messages?.[0]?.text).toContain("<matrixx-env>");
  });

  test("empty messages array is a no-op that does not throw", async () => {
    //#given an empty flat message list
    const event: FlatEvent = { sessionID: "ses_test", messages: [] };
    //#when applying the injection
    await applyEnvContextInjector(event);
    //#then nothing happens and nothing throws
    expect(event.messages).toHaveLength(0);
  });

  test("missing messages is a no-op that does not throw", async () => {
    //#given an event with no messages field
    const event: FlatEvent = { sessionID: "ses_test" };
    //#when applying the injection
    await applyEnvContextInjector(event);
    //#then nothing throws
    expect(event.messages).toBeUndefined();
  });

  test("no user message leaves everything untouched", async () => {
    //#given a turn with no user message
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [assistantMessage("msg_1", "How can I help?")],
    };
    //#when applying the injection
    await applyEnvContextInjector(event);
    //#then the assistant message is untouched
    expect(event.messages?.[0]?.content?.[0]?.text).not.toContain("<matrixx-env>");
  });

  test("user message with empty content array gets an env block without crashing", async () => {
    //#given a user message whose content array is empty
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [{ id: "msg_1", role: "user", content: [] }],
    };
    //#when applying the injection
    await applyEnvContextInjector(event);
    //#then a text block carrying the env block is appended
    const content = event.messages?.[0]?.content ?? [];
    expect(content).toHaveLength(1);
    expect(content[0]?.text).toContain("<matrixx-env>");
  });
});
