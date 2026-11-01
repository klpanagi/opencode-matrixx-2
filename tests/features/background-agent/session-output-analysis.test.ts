//#given analysis-only session must not count as output
//#when messages contain only <analysis> blocks
//#then messagesHaveAssistantOutput is false and validate fails safe
import { describe, expect, test } from "bun:test";
import { messagesHaveAssistantOutput, stripAnalysisBlocks } from "../../../src/features/background-agent/session-output";
describe("analysis guard", () => {
  test("strips analysis blocks", () => {
    expect(stripAnalysisBlocks("<analysis>plan</analysis> hello").trim()).toBe("hello");
    expect(stripAnalysisBlocks("<analysis>x</analysis>")).toBe("");
  });
  test("analysis-only is not output", () => {
    const msgs = [{ type: "assistant", content: [{ type: "text", text: "<analysis>thinking</analysis>" }] }] as any;
    expect(messagesHaveAssistantOutput(msgs)).toBe(false);
  });
  test("real text counts", () => {
    const msgs = [{ type: "assistant", content: [{ type: "text", text: "done: migrated 3 files" }] }] as any;
    expect(messagesHaveAssistantOutput(msgs)).toBe(true);
  });
});
