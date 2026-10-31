import { describe, expect, test } from "bun:test";
import { buildSubagentTitle } from "../../../src/features/background-agent/handle-index";
import { buildBackgroundTitle, buildContinuationTitle, buildTaskTitle, resolveTaskDescription } from "../../../src/tools/delegate-task/task-title";

describe("task-title fallback", () => {
  //#given missing description
  //#when resolving
  //#then never undefined/empty
  test("undefined description falls back", () => {
    const d = resolveTaskDescription({ description: undefined, prompt: "Fix the recorder bug now", category: "blue-pill" });
    expect(d).not.toBe("");
    expect(d.toLowerCase()).not.toContain("undefined");
  });
  test("literal 'undefined' string falls back", () => {
    expect(resolveTaskDescription({ description: "undefined", prompt: "" })).toBe("Background task");
  });
  test("buildTaskTitle never contains undefined", () => {
    expect(buildTaskTitle(undefined, "trinity").toLowerCase()).not.toContain("undefined");
    expect(buildSubagentTitle(undefined, "trinity").toLowerCase()).not.toContain("undefined");
  });
  test("continuation title falls back", () => {
    expect(buildContinuationTitle(undefined)).toBe("Continue: Background task");
  });
});


describe("labeled titles", () => {
  //#given an agent and category
  //#when building labeled titles
  //#then the label and BG prefix render
  test("sync title carries agent category label without BG", () => {
    expect(buildTaskTitle("Implement feature X", "mouse", "bullet-time")).toBe(
      "Mouse[bullet-time] — Implement feature X"
    );
  });
  test("background title carries BG prefix", () => {
    expect(buildBackgroundTitle("Implement feature X", "mouse", "bullet-time")).toBe(
      "[BG] Mouse[bullet-time] — Implement feature X"
    );
  });
  test("direct agent without category omits brackets", () => {
    expect(buildBackgroundTitle("Do research", "oracle")).toBe("[BG] Oracle — Do research");
  });
});