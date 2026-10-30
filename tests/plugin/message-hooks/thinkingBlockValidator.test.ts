import { describe, expect, test } from "bun:test";

import { MESSAGE_HOOK_TABLE } from "../../../src/plugin/message-hooks/index";
import { applyThinkingBlockValidator } from "../../../src/hooks/thinking-block-validator/flat";

type FlatPart = { type?: string; text?: string; thinking?: string; [key: string]: unknown };
type FlatMessage = {
  id?: string;
  role?: string;
  type?: string;
  text?: string;
  content?: FlatPart[];
  model?: unknown;
  [key: string]: unknown;
};
type FlatEvent = {
  kind?: string;
  sessionID?: string;
  model?: unknown;
  messages?: FlatMessage[];
  [key: string]: unknown;
};

const THINKING_MODEL = { providerID: "anthropic", modelID: "claude-sonnet-4-5" };
const PLAIN_MODEL = { providerID: "openai", modelID: "gpt-4o-mini" };

function userMessage(id: string): FlatMessage {
  return { id, role: "user", content: [{ type: "text", text: "Do it" }] };
}

function thinkingAssistant(id: string, thinking: string): FlatMessage {
  return { id, role: "assistant", content: [{ type: "thinking", thinking }] };
}

function toolAssistant(id: string): FlatMessage {
  return {
    id,
    role: "assistant",
    content: [
      { type: "text", text: "Calling a tool" },
      { type: "tool", callID: "call_1" },
    ],
  };
}

describe("thinkingBlockValidator flat port (Task 26 Group B)", () => {
  test("prepends a thinking block to an assistant message with content but no thinking", async () => {
    //#given an extended-thinking model and a prior thinking block to reuse
    const event: FlatEvent = {
      sessionID: "ses_test",
      model: THINKING_MODEL,
      messages: [userMessage("msg_1"), thinkingAssistant("msg_2", "Deep thought"), toolAssistant("msg_3")],
    };
    //#when applying the flat thinking-block validation
    await applyThinkingBlockValidator(event);
    //#then the tool message gains the cached thinking block up front
    const fixed = event.messages?.[2]?.content ?? [];
    expect(fixed[0]?.type).toBe("thinking");
    expect(fixed[0]?.thinking).toBe("Deep thought");
    expect(event.messages?.[1]?.content?.[0]?.type).toBe("thinking");
  });

  test("uses the fallback thinking block when no prior thinking exists", async () => {
    //#given an extended-thinking model with no prior thinking content
    const event: FlatEvent = {
      sessionID: "ses_test",
      model: THINKING_MODEL,
      messages: [userMessage("msg_1"), toolAssistant("msg_2")],
    };
    //#when applying the flat thinking-block validation
    await applyThinkingBlockValidator(event);
    //#then the fallback continuation block is prepended
    const fixed = event.messages?.[1]?.content ?? [];
    expect(fixed[0]?.type).toBe("thinking");
    expect(fixed[0]?.thinking).toBe("[Continuing from previous reasoning]");
  });

  test("leaves messages untouched for a non-thinking model", async () => {
    //#given a model without extended thinking
    const event: FlatEvent = {
      sessionID: "ses_test",
      model: PLAIN_MODEL,
      messages: [userMessage("msg_1"), toolAssistant("msg_2")],
    };
    //#when applying the flat thinking-block validation
    await applyThinkingBlockValidator(event);
    //#then nothing is prepended
    expect(event.messages?.[1]?.content?.[0]?.type).toBe("text");
    expect(event.messages?.[1]?.content).toHaveLength(2);
  });

  test("empty messages array is a no-op that does not throw", async () => {
    //#given an empty flat message list
    const event: FlatEvent = { sessionID: "ses_test", model: THINKING_MODEL, messages: [] };
    //#when applying the validation
    await applyThinkingBlockValidator(event);
    //#then nothing happens and nothing throws
    expect(event.messages).toHaveLength(0);
  });

  test("assistant message with empty content array does not crash", async () => {
    //#given an assistant message with no content blocks
    const event: FlatEvent = {
      sessionID: "ses_test",
      model: THINKING_MODEL,
      messages: [userMessage("msg_1"), { id: "msg_2", role: "assistant", content: [] }],
    };
    //#when applying the validation
    await applyThinkingBlockValidator(event);
    //#then nothing is prepended and nothing throws
    expect(event.messages?.[1]?.content).toHaveLength(0);
  });

  test("generate registration path applies the same transformation", async () => {
    //#given the mapping-table row registers thinkingBlockValidator on context and generate
    const row = MESSAGE_HOOK_TABLE.find((entry) => entry.hook === "thinkingBlockValidator");
    expect(row?.targetHooks).toContain("context");
    expect(row?.targetHooks).toContain("generate");
    //#when a generate-kind event reaches the flat validator
    const event: FlatEvent = {
      kind: "generate",
      sessionID: "ses_test",
      model: THINKING_MODEL,
      messages: [userMessage("msg_1"), toolAssistant("msg_2")],
    };
    await applyThinkingBlockValidator(event);
    //#then the same thinking-block fix is applied on the generate path
    const fixed = event.messages?.[1]?.content ?? [];
    expect(fixed[0]?.type).toBe("thinking");
    expect(fixed[0]?.thinking).toBe("[Continuing from previous reasoning]");
  });
});
