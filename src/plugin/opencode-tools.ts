import type { V2ToolContext, V2ToolInfo } from "./context";
import {
  buildMatrixxToolContext,
  normalizeResult,
  toInputSchema,
  type MatrixxToolDefinition,
} from "../tools/shared/define-tool";
import { TASK_TOOL_OPTIONS } from "../tools/delegate-task/tool-options";

export interface ToolBridgeDeps {
  directory: string;
  worktree: string;
  assertPermission?: (input: Record<string, unknown>) => Promise<void>;
  context?: unknown;
}

const REGISTRATION_OPTIONS: Record<string, Record<string, unknown>> = {
  task: TASK_TOOL_OPTIONS,
};

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
