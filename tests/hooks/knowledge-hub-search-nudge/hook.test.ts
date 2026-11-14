import { describe, expect, test } from "bun:test";
import type { MatrixxContext } from "../../../src/plugin/tool/context";
import type { LoadedHub } from "../../../src/features/knowledge-hub/loader";
import { createKnowledgeHubSearchNudgeHook } from "../../../src/hooks/knowledge-hub-search-nudge/hook";

function makeCtx(): MatrixxContext {
  return { directory: "/tmp", client: {} } as unknown as MatrixxContext;
}

function makeHub(name: string): LoadedHub {
  return {
    name,
    root: `/hubs/${name}`,
    indexPath: `/hubs/${name}/_index.md`,
    indexPresent: true,
    pinnedFiles: [],
    scope: "global",
    mode: "router-only",
    exclude: [],
  };
}

function nudgeArgs(): { args: Record<string, unknown>; message?: string } {
  return { args: {} };
}

describe("createKnowledgeHubSearchNudgeHook", () => {
  test("nudges on websearch", async () => {
    //#given a hub and a websearch call
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), { hubs: [makeHub("kb")] });
    const output = nudgeArgs();
    //#when the hook runs before websearch
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c1" },
      output,
    );
    //#then output.message names the hub and the absolute-root directive
    expect(output.message).toContain('"kb"');
    expect(output.message).toContain("absolute");
    expect(output.message).not.toContain("@hub/");
    expect(output.message?.length ?? 0).toBeLessThan(300);
  });

  test("nudges on webfetch", async () => {
    //#given a hub and a webfetch call
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), { hubs: [makeHub("kb")] });
    const output = nudgeArgs();
    //#when the hook runs before webfetch
    await hook["tool.execute.before"](
      { tool: "webfetch", sessionID: "ses-1", callID: "c1" },
      output,
    );
    //#then output.message is set
    expect(output.message).toContain('"kb"');
    expect(output.message?.length ?? 0).toBeLessThan(300);
  });

  test("silent on unrelated tools", async () => {
    //#given a hub and non-search tools
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), { hubs: [makeHub("kb")] });
    //#when the hook runs before read and bash
    const readOutput = nudgeArgs();
    await hook["tool.execute.before"](
      { tool: "read", sessionID: "ses-1", callID: "c1" },
      readOutput,
    );
    const bashOutput = nudgeArgs();
    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "c2" },
      bashOutput,
    );
    //#then no message is set
    expect(readOutput.message).toBeUndefined();
    expect(bashOutput.message).toBeUndefined();
  });

  test("silent with empty hubs", async () => {
    //#given no hubs configured
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), { hubs: [] });
    const output = nudgeArgs();
    //#when the hook runs before websearch
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c1" },
      output,
    );
    //#then no message is set
    expect(output.message).toBeUndefined();
  });

  test("calls the provided loader on every invocation", async () => {
    //#given a loader whose answer changes between calls
    let calls = 0;
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), {
      loadHubs: () => {
        calls += 1;
        return calls === 1 ? [] : [makeHub("kb")];
      },
    });
    const first = nudgeArgs();
    const second = nudgeArgs();
    //#when websearch runs twice
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c1" },
      first,
    );
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c2" },
      second,
    );
    //#then the loader was consulted again (no forever cache)
    expect(calls).toBe(2);
    expect(first.message).toBeUndefined();
    expect(second.message).toContain('"kb"');
  });

  test("never throws when hub resolution fails", async () => {
    //#given a loader that throws
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), {
      loadHubs: () => {
        throw new Error("no config");
      },
    });
    const output = nudgeArgs();
    //#when the hook runs before websearch
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c1" },
      output,
    );
    //#then it resolves without throwing and stays silent
    expect(output.message).toBeUndefined();
  });

  test("prepends the shared router directive without the @hub/ convention", async () => {
    //#given a hub
    const hook = createKnowledgeHubSearchNudgeHook(makeCtx(), { hubs: [makeHub("kb")] });
    const output = nudgeArgs();
    //#when the hook runs before websearch
    await hook["tool.execute.before"](
      { tool: "websearch", sessionID: "ses-1", callID: "c1" },
      output,
    );
    //#then the directive leads and names absolute paths only
    expect(output.message?.startsWith("Consult these hubs")).toBe(true);
    expect(output.message).toContain("absolute");
    expect(output.message).not.toContain("@hub/");
  });
});
