import type { ZodType } from "zod";
import { z } from "zod";
import type { V2ToolContext, V2ToolInfo, V2ToolResult } from "../../plugin/context"
import { jsonSafeMetadata, log } from "../../shared";
import { TASK_TOOL_OPTIONS } from "../delegate-task/tool-options";

/** Tool execution result: a plain string or a structured payload. */
export type MatrixxToolResult =
  | string
  | {
      output?: unknown;
      metadata?: Record<string, unknown>;
      title?: string;
    };

/** Context passed to every Matrixx tool execute function. */
export interface MatrixxToolContext {
  readonly sessionID: string;
  readonly messageID: string;
  readonly agent: string;
  readonly directory: string;
  readonly worktree: string;
  readonly abort: AbortSignal;
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
  ask(input: Record<string, unknown>): Promise<void>;
}

/**
 * The single tool authoring shape for matrixx tools.
 *
 * `TArgs` is a Zod raw shape (a plain object mapping names to Zod schemas),
 * converted to plain JSON Schema at registration time via
 * `z.toJSONSchema(z.object(args), { io: "input" })`.
 */
export interface MatrixxToolDefinition<
  TArgs extends Record<string, ZodType> = Record<string, ZodType>,
> {
  description: string;
  args: TArgs;
  execute(
    args: z.infer<z.ZodObject<TArgs>>,
    ctx: MatrixxToolContext,
  ): Promise<MatrixxToolResult>;
  options?: {
    codemode?: boolean;
  };
}

export type DefinedTool<TArgs extends Record<string, ZodType> = Record<string, ZodType>> =
  MatrixxToolDefinition<TArgs> & { name: string };

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The only tool authoring entry point. Validates eagerly so a malformed
 * definition fails fast with an explicit error instead of registering a
 * silently undefined schema.
 */
export function defineTool<TArgs extends Record<string, ZodType>>(
  name: string,
  def: MatrixxToolDefinition<TArgs>,
): DefinedTool<TArgs> {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`defineTool: name must be a non-empty string, got ${JSON.stringify(name)}`);
  }
  if (!def || typeof def !== "object") {
    throw new Error(`defineTool("${name}"): definition must be an object, got ${String(def)}`);
  }
  if (typeof def.description !== "string" || def.description.length === 0) {
    throw new Error(`defineTool("${name}"): description must be a non-empty string`);
  }
  if (!isPlainObjectRecord(def.args)) {
    throw new Error(
      `defineTool("${name}"): args must be a plain object of Zod schemas, got ` +
        (Array.isArray(def.args) ? "array" : String(def.args === null ? "null" : typeof def.args)),
    );
  }
  if (typeof def.execute !== "function") {
    throw new Error(`defineTool("${name}"): execute must be a function`);
  }
  return { ...def, name };
}

/** Convert a Zod raw shape to plain JSON Schema (no Zod instances survive). */
export function toInputSchema(name: string, args: unknown): Record<string, unknown> {
  if (!isPlainObjectRecord(args)) {
    throw new Error(
      `toInputSchema("${name}"): args must be a plain object of Zod schemas, got ` +
        (Array.isArray(args) ? "array" : String(args === null ? "null" : typeof args)),
    );
  }
  try {
    const { $schema, ...jsonSchema } = z.toJSONSchema(z.object(args as Record<string, ZodType>), {
      io: "input",
    }) as Record<string, unknown>;
    void $schema;
    return jsonSafeMetadata(jsonSchema);
  } catch (error) {
    log("[matrixx] tool schema conversion failed", {
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `toInputSchema("${name}"): failed to convert args to JSON Schema: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** Normalize a tool result, routing metadata through jsonSafeMetadata.
 *
 * Every result carries BOTH channels: `content` (rendered message parts) and
 * `output` (the hook-visible result and declared tool output). The host hook
 * layer only forwards `output` to tool.execute.after hooks and derives the
 * final message from it — a content-only result arrives as an empty string
 * downstream (observed live as the empty task response).
 */
export function normalizeResult(result: unknown): V2ToolResult {
  if (typeof result === "string") return { content: result, output: result };
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const metadata = jsonSafeMetadata(
      record.metadata && typeof record.metadata === "object"
        ? { ...(record.metadata as Record<string, unknown>) }
        : {},
    ) as Record<string, unknown>;
    if (typeof record.title === "string" && metadata.title === undefined) {
      metadata.title = record.title;
    }
    const text = typeof record.output === "string" ? record.output : record.content;
    if (typeof text === "string") return { content: text, output: text, metadata };
    if (record.output !== undefined) {
      const fallback = safeOutputText(record.output);
      return { content: fallback, output: fallback, metadata };
    }
    return { metadata };
  }
  const text = result === undefined ? "" : String(result);
  return { content: text, output: text };
}

function safeOutputText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Build the Matrixx tool context from a V2 tool context and bridge deps. */
export function buildMatrixxToolContext(
  context: V2ToolContext,
  deps: {
    directory: string;
    worktree: string;
    assertPermission?: (input: Record<string, unknown>) => Promise<void>;
  },
): MatrixxToolContext {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: deps.directory,
    worktree: deps.worktree,
    abort: context.signal,
    metadata: (input: { title?: string; metadata?: Record<string, unknown> }): void => {
      const payload: Record<string, unknown> = jsonSafeMetadata({ ...(input.metadata ?? {}) });
      if (input.title !== undefined) payload.title = input.title;
      void context.progress(payload).catch(() => undefined);
    },
    ask: async (input: Record<string, unknown>): Promise<void> => {
      if (!deps.assertPermission) return;
      await deps.assertPermission(input);
    },
  };
}

/**
 * Deps needed to bridge a Matrixx tool definition onto the V2 tool registry.
 * Relocated verbatim from the deleted `src/plugin/opencode-tools.ts` (task 24)
 * so the V2 `Tool.Info` translation survives and R1 still holds.
 */
export interface ToolBridgeDeps {
  directory: string;
  worktree: string;
  assertPermission?: (input: Record<string, unknown>) => Promise<void>;
  context?: unknown;
}

const REGISTRATION_OPTIONS: Record<string, Record<string, unknown>> = {
  task: TASK_TOOL_OPTIONS,
};

export function emitToolInfo(
  name: string,
  definition: MatrixxToolDefinition,
  deps: ToolBridgeDeps,
): V2ToolInfo | undefined {
  if (!isPlainObjectRecord(definition.args)) {
    throw new Error(
      `emitToolInfo("${name}"): args must be a plain object of Zod schemas, got ` +
        (Array.isArray(definition.args) ? "array" : String(definition.args === null ? "null" : typeof definition.args)),
    );
  }
  let input: Record<string, unknown>;
  try {
    input = toInputSchema(name, definition.args);
  } catch {
    return undefined;
  }
  const options = REGISTRATION_OPTIONS[name];
  return {
    name,
    description: definition.description,
    input,
    // Declared string output: normalizeResult always surfaces a string on the
    // output channel, and the host requires a declared schema whenever a
    // result carries output. Without this the hook layer sees an empty string.
    output: { type: "string" },
    ...(options === undefined ? {} : { options }),
    execute: async (rawInput: unknown, context: V2ToolContext) => {
      const result = await definition.execute(
        rawInput as never,
        buildMatrixxToolContext(context, deps) as never,
      );
      return normalizeResult(result);
    },
  };
}

export function emitToolInfos(
  tools: Record<string, MatrixxToolDefinition>,
  deps: ToolBridgeDeps,
): V2ToolInfo[] {
  const converted: V2ToolInfo[] = [];
  for (const [name, definition] of Object.entries(tools)) {
    const tool = emitToolInfo(name, definition, deps);
    if (tool) converted.push(tool);
  }
  return converted;
}

