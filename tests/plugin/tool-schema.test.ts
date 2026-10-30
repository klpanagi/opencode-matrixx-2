import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { emitToolInfo } from "../../src/tools/shared/define-tool";
import {
  defineTool,
  normalizeResult,
  toInputSchema,
} from "../../src/tools/shared/define-tool";

const deps = { directory: "/tmp/x", worktree: "/tmp/x" };

function walk(value: unknown, seen = new Set<unknown>()): void {
  if (value === null || value === undefined) return;
  const kind = typeof value;
  expect(kind === "function" || kind === "symbol").toBe(false);
  if (kind !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const v of Object.values(value as Record<string, unknown>)) walk(v, seen);
}

describe("tool schema", () => {
  test("sample string tool emits plain JSON Schema", () => {
    //#given a sample tool definition with a required string and an optional string
    const def = defineTool("grep", {
      description: "search",
      args: {
        pattern: z.string().describe("regex"),
        include: z.string().optional().describe("glob"),
      },
      execute: async () => "ok",
    });
    //#when converted for the registry
    const info = emitToolInfo("grep", def, deps);
    //#then the input is plain JSON Schema with no Zod instance surviving stringify
    expect(info?.name).toBe("grep");
    const input = info?.input as Record<string, unknown>;
    expect(input.type).toBe("object");
    const props = input.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["include", "pattern"]);
    expect(input.required).toEqual(["pattern"]);
    walk(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    expect(JSON.stringify(input)).not.toContain("_zod");
  });

  test("sample numeric tool emits plain JSON Schema", () => {
    //#given a tool with number, boolean and enum args
    const def = defineTool("counter", {
      description: "count",
      args: {
        limit: z.number().describe("max"),
        verbose: z.boolean().optional(),
        mode: z.enum(["fast", "slow"]),
      },
      execute: async () => "ok",
    });
    //#when converted
    const info = emitToolInfo("counter", def, deps);
    //#then schema is plain JSON with all three properties
    const input = info?.input as Record<string, unknown>;
    expect(input.type).toBe("object");
    expect(Object.keys(input.properties as Record<string, unknown>).sort()).toEqual([
      "limit",
      "mode",
      "verbose",
    ]);
    walk(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
  });

  test("structured execute results route metadata through jsonSafeMetadata", () => {
    //#given a result carrying a Date instance and a function value
    //#when normalized
    const out = normalizeResult({
      output: "done",
      metadata: { at: new Date("2026-01-01T00:00:00.000Z"), fn: (() => 1) as unknown as string },
    });
    //#then metadata is JSON-safe: Date stringified, function dropped
    expect(out.content).toBe("done");
    expect(out.metadata?.at).toBe("2026-01-01T00:00:00.000Z");
    expect("fn" in (out.metadata ?? {})).toBe(false);
    walk(out);
  });

  test("task tool keeps codemode:false while others stay unset", () => {
    //#given the delegate definition with direct-only options
    const taskDef = defineTool("task", {
      description: "delegate",
      args: { prompt: z.string() },
      execute: async () => "ok",
      options: { codemode: false },
    });
    const readDef = defineTool("read", {
      description: "read",
      args: { path: z.string() },
      execute: async () => "ok",
    });
    //#when converted
    //#then only the task tool carries registration options
    expect(emitToolInfo("task", taskDef, deps)?.options).toEqual({ codemode: false });
    expect(emitToolInfo("read", readDef, deps)?.options).toBeUndefined();
  });

  test("negative: non-object args produce an explicit error", () => {
    //#given definitions whose args are not plain objects
    const badArgs = [null, [z.string()], "pattern", 42];
    for (const args of badArgs) {
      //#when authored via defineTool
      //#then an explicit error names the problem instead of a silently undefined schema
      expect(() =>
        defineTool("bad", {
          description: "bad",
          args: args as never,
          execute: async () => "ok",
        }),
      ).toThrow(/plain object/);
    }
    //#when converted via toInputSchema directly
    //#then the error is explicit as well
    expect(() => toInputSchema("bad", null)).toThrow(/plain object/);
    expect(() => toInputSchema("bad", [z.string()])).toThrow(/plain object/);
    expect(() =>
      emitToolInfo(
        "bad",
        { description: "bad", args: null as never, execute: async () => "ok" },
        deps,
      ),
    ).toThrow(/plain object/);
  });
});
