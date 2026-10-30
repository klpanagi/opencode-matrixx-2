import { describe, expect, test } from "bun:test";

import type { MatrixxContext } from "../../../src/plugin/context";
import type { MessageHookRow } from "../../../src/plugin/message-hooks/index";
import {
  MESSAGE_HOOK_TABLE,
  registerMessageHooks,
  validateMessageHookTable,
} from "../../../src/plugin/message-hooks/index";

const EXPECTED_HOOK_ORDER = [
  "domainKeywordDetector",
  "knowledgeHubInjector",
  "contextInjectorMessagesTransform",
  "envContextInjector",
  "thinkingBlockValidator",
  "evolutionHitl",
  "dcpNudgeSanitizer",
  "toolPairValidator",
] as const;

function makeRecordingCtx(): {
  ctx: MatrixxContext;
  seen: Array<{ kind: string; cb: (event: never) => Promise<void> }>;
} {
  //#given a session double that records every hook registration
  const seen: Array<{ kind: string; cb: (event: never) => Promise<void> }> = [];
  const ctx = {
    session: {
      hook: async (kind: string, cb: (event: never) => Promise<void>) => {
        seen.push({ kind, cb });
        return { dispose: async () => {} };
      },
    },
  } as unknown as MatrixxContext;
  return { ctx, seen };
}

describe("message-hooks mapping table (Task 25)", () => {
  test("lists exactly 8 hooks in legacy fan-out call order", () => {
    //#given the 8 transform hooks in legacy fan-out order
    //#when reading the mapping table
    const names = MESSAGE_HOOK_TABLE.map((row) => row.hook);
    //#then every hook is present exactly once, in order
    expect(names).toEqual([...EXPECTED_HOOK_ORDER]);
  });

  test("every row names hook, v1Reads, v2Reads and >= 1 targetHook", () => {
    //#given the mapping table
    //#when inspecting each row
    //#then no row is missing reads and none has an empty targetHooks
    for (const row of MESSAGE_HOOK_TABLE) {
      expect(row.hook.length).toBeGreaterThan(0);
      expect(row.v1Reads.length).toBeGreaterThan(0);
      expect(row.v2Reads.length).toBeGreaterThan(0);
      expect(row.targetHooks.length).toBeGreaterThan(0);
    }
  });

  test("toolPairValidator registers on context and generate", () => {
    //#given the validator row
    //#when reading its target hooks
    const row = MESSAGE_HOOK_TABLE.find((r) => r.hook === "toolPairValidator");
    //#then auxiliary (generate) requests are covered, not just context
    expect(row?.targetHooks).toContain("generate");
    expect(row?.targetHooks).toContain("context");
  });

  test("preserves the dcpNudgeSanitizer ordering comment verbatim", () => {
    //#given legacy fan-out ordering (Matrixx runs before DCP)
    //#when reading the mapping module source
    return (async () => {
      const source = await Bun.file(`${import.meta.dir}/../../../src/plugin/message-hooks/index.ts`).text();
      //#then the ordering comment survives word-for-word
      expect(source).toContain(
        "// Ordering: Matrixx runs before DCP (plugin index 0 vs 1), so this sanitizer",
      );
      expect(source).toContain(
        "// cleans prior-cycle sticky nudges and caps accumulation at ~1/cycle. It cannot",
      );
      expect(source).toContain("// suppress the nudge DCP injects later in the same cycle.");
    })();
  });
});

describe("registerMessageHooks", () => {
  test("registers session.hook for every target kind in every row", async () => {
    //#given a recording session double
    const { ctx, seen } = makeRecordingCtx();
    //#when registering the native message hooks
    const registrations = await registerMessageHooks(ctx);
    //#then one registration per (row, kind) pair: 8x context, 2x compaction, 2x generate
    const kinds = seen.map((s) => s.kind).sort();
    expect(kinds).toEqual(
      ["context", "context", "context", "context", "context", "context", "context", "context",
        "compaction", "compaction",
        "generate", "generate"].sort(),
    );
    expect(registrations).toHaveLength(12);
    expect(registrations).toHaveLength(seen.length);
  });

  test("registered callbacks are no-op placeholders that never throw", async () => {
    //#given the registered placeholder callbacks
    const { ctx, seen } = makeRecordingCtx();
    await registerMessageHooks(ctx);
    //#when invoking every callback with an empty event
    //#then none throws (Task 26 fills the flat-Message[] bodies)
    for (const { cb } of seen) {
      await cb({} as never);
    }
  });
});

describe("validateMessageHookTable negative controls", () => {
  test("rejects a row with an empty targetHooks", () => {
    //#given a table where contextInjectorMessagesTransform registers nowhere
    const bad: MessageHookRow[] = MESSAGE_HOOK_TABLE.map((row) =>
      row.hook === "contextInjectorMessagesTransform" ? { ...row, targetHooks: [] } : row,
    );
    //#when validating
    //#then the gate fails closed
    expect(() => validateMessageHookTable(bad)).toThrow(/empty targetHooks/);
  });

  test("rejects a toolPairValidator row missing generate", () => {
    //#given a table that silently drops auxiliary requests
    const bad: MessageHookRow[] = MESSAGE_HOOK_TABLE.map((row) =>
      row.hook === "toolPairValidator" ? { ...row, targetHooks: ["context"] as const } : row,
    );
    //#when validating
    //#then the gate fails closed
    expect(() => validateMessageHookTable(bad)).toThrow(/must include "generate"/);
  });

  test("rejects a table that is not exactly 8 rows", () => {
    //#given a table with a hook silently dropped
    const bad = MESSAGE_HOOK_TABLE.slice(0, 7);
    //#when validating
    //#then the gate fails closed
    expect(() => validateMessageHookTable(bad)).toThrow(/exactly 8/);
  });
});
