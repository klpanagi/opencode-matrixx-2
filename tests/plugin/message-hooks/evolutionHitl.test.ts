import { describe, expect, test } from "bun:test";

import type { EvolutionConfig } from "../../../src/config/schema/evolution";
import { applyEvolutionHitl } from "../../../src/hooks/evolution-hitl/flat";

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

function enabledConfig(): EvolutionConfig {
  return {
    enabled: true,
    watcher: { maxArgChars: 4000, maxOutputChars: 8000, skipTools: [] },
    compressor: { provider: "llm", minTraces: 5, maxInputTokens: 32000, trigger: "both" },
    writer: {
      outputDir: ".matrixx/evolution/skills",
      globalSkills: false,
      allowToolGeneration: false,
      allowAgentGeneration: false,
    },
    governance: {
      requireApproval: true,
      autoPromote: false,
      autoPromoteThreshold: 0.85,
      minConfidence: 0.7,
    },
    retention: { traceDays: 30, maxPending: 10 },
    budget: { maxCompressionsPerHour: 1, maxCostCentsPerDay: 100 },
  };
}

function userMessage(id: string, text: string): FlatMessage {
  return { id, role: "user", content: [{ type: "text", text }] };
}

describe("evolutionHitl flat port (Task 26 Group B)", () => {
  test("injects the pending-review prompt into the last user message", async () => {
    //#given an enabled config with one pending skill and no recent prompt
    let updated: Record<string, unknown> | undefined;
    const deps = {
      getState: async () => ({ totalTraces: 0, totalCompressions: 0 }),
      updateState: async (patch: Record<string, unknown>) => {
        updated = patch;
      },
      listPending: async () => ["my-skill"],
    };
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [userMessage("msg_1", "First"), userMessage("msg_2", "Review please")],
    };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, enabledConfig(), undefined, deps);
    //#then the last user message carries the review prompt and state is updated
    const text = event.messages?.[1]?.content?.[0]?.text ?? "";
    expect(text).toContain("Review please");
    expect(text).toContain("my-skill");
    expect(text).toContain("/evolution approve my-skill");
    expect(event.messages?.[0]?.content?.[0]?.text).not.toContain("my-skill");
    expect(typeof updated?.lastPromptAt).toBe("string");
  });

  test("disabled config leaves messages untouched", async () => {
    //#given a disabled evolution config
    let listed = false;
    const deps = {
      getState: async () => ({ totalTraces: 0, totalCompressions: 0 }),
      updateState: async (_patch: Record<string, unknown>) => {},
      listPending: async () => {
        listed = true;
        return ["my-skill"];
      },
    };
    const event: FlatEvent = { sessionID: "ses_test", messages: [userMessage("msg_1", "Hi")] };
    const config = { ...enabledConfig(), enabled: false };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, config, undefined, deps);
    //#then nothing is injected and pending is never listed
    expect(event.messages?.[0]?.content?.[0]?.text).toBe("Hi");
    expect(listed).toBe(false);
  });

  test("recent prompt timestamp suppresses injection", async () => {
    //#given a prompt was already injected within the last hour
    const deps = {
      getState: async () => ({
        totalTraces: 0,
        totalCompressions: 0,
        lastPromptAt: new Date().toISOString(),
      }),
      updateState: async (_patch: Record<string, unknown>) => {},
      listPending: async () => ["my-skill"],
    };
    const event: FlatEvent = { sessionID: "ses_test", messages: [userMessage("msg_1", "Hi")] };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, enabledConfig(), undefined, deps);
    //#then the message is untouched
    expect(event.messages?.[0]?.content?.[0]?.text).toBe("Hi");
  });

  test("empty pending list leaves messages untouched", async () => {
    //#given no pending skills awaiting review
    const deps = {
      getState: async () => ({ totalTraces: 0, totalCompressions: 0 }),
      updateState: async (_patch: Record<string, unknown>) => {},
      listPending: async () => [],
    };
    const event: FlatEvent = { sessionID: "ses_test", messages: [userMessage("msg_1", "Hi")] };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, enabledConfig(), undefined, deps);
    //#then the message is untouched
    expect(event.messages?.[0]?.content?.[0]?.text).toBe("Hi");
  });

  test("empty messages array is a no-op that does not throw", async () => {
    //#given an empty flat message list with pending skills
    const deps = {
      getState: async () => ({ totalTraces: 0, totalCompressions: 0 }),
      updateState: async (_patch: Record<string, unknown>) => {},
      listPending: async () => ["my-skill"],
    };
    const event: FlatEvent = { sessionID: "ses_test", messages: [] };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, enabledConfig(), undefined, deps);
    //#then nothing happens and nothing throws
    expect(event.messages).toHaveLength(0);
  });

  test("user message with empty content array gets a review block without crashing", async () => {
    //#given a user message whose content array is empty
    const deps = {
      getState: async () => ({ totalTraces: 0, totalCompressions: 0 }),
      updateState: async (_patch: Record<string, unknown>) => {},
      listPending: async () => ["my-skill"],
    };
    const event: FlatEvent = {
      sessionID: "ses_test",
      messages: [{ id: "msg_1", role: "user", content: [] }],
    };
    //#when applying the flat evolution-hitl injection
    await applyEvolutionHitl(event, enabledConfig(), undefined, deps);
    //#then a text block carrying the review prompt is appended
    const content = event.messages?.[0]?.content ?? [];
    expect(content).toHaveLength(1);
    expect(content[0]?.text).toContain("my-skill");
  });
});
