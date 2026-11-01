//#given sync poller sees analysis-only assistant text
//#when hasAssistantContent checked
//#then false so poll loop does not exit early
import { describe, expect, test } from "bun:test";
import { hasAssistantContent } from "../../../src/tools/delegate-task/sync-session-poller";
describe("poller analysis guard", () => {
  test("analysis-only false", () => {
    expect(hasAssistantContent([{ type: "assistant", content: [{ type: "text", text: "<analysis>a</analysis>" }] } as any] as any)).toBe(false);
  });
  test("real content true", () => {
    expect(hasAssistantContent([{ type: "assistant", content: [{ type: "text", text: "result" }] } as any] as any)).toBe(true);
  });
});
