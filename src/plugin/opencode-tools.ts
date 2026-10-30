/**
 * V1 tool → V2 tool translation.
 *
 * matrixx tools are V1 `ToolDefinition`s (`{ description, args: ZodRawShape,
 * execute(args, context): Promise<string> }`). V2 registers `Tool.Info`s
 * (`{ name, description, input, execute(input, context): Promise<Result> }`)
 * through `ctx.tool.transform`.
 *
 * `args` is converted to a JSON Schema here, with this package's zod copy:
 * OpenCode resolves a different zod and cannot walk a schema built by ours.
 */

import type { ToolDefinition } from "@opencode-ai/plugin"
import { z } from "zod"
import { jsonSafeMetadata, log } from "../shared"
import { TASK_TOOL_OPTIONS } from "../tools/delegate-task/tool-options"
import type { V2ToolContext, V2ToolInfo, V2ToolResult } from "./opencode-types"
import type { ToolsRecord } from "./types"

export interface ToolBridgeDeps {
  directory: string
  worktree: string
  assertPermission?: (input: Record<string, unknown>) => Promise<void>
  context?: unknown
}

/**
 * Per-tool registration options. Only the delegate-task tool is direct-only;
 * every other tool stays reachable from code mode.
 */
const REGISTRATION_OPTIONS: Record<string, Record<string, unknown>> = {
  task: TASK_TOOL_OPTIONS,
}

function normalizeResult(result: unknown): V2ToolResult {
  if (typeof result === "string") return { content: result }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? { ...(record.metadata as Record<string, unknown>) }
        : {}
    if (typeof record.title === "string" && metadata.title === undefined) {
      metadata.title = record.title
    }
    const text = typeof record.output === "string" ? record.output : record.content
    if (typeof text === "string") return { content: text, metadata }
    if (record.output !== undefined) return { output: record.output, metadata }
    return { metadata }
  }
  return { content: result === undefined ? "" : String(result) }
}

function buildV1ToolContext(context: V2ToolContext, deps: ToolBridgeDeps) {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: deps.directory,
    worktree: deps.worktree,
    abort: context.signal,
    metadata: (input: { title?: string; metadata?: Record<string, unknown> }): void => {
      const payload: Record<string, unknown> = jsonSafeMetadata({ ...(input.metadata ?? {}) })
      if (input.title !== undefined) payload.title = input.title
      void context.progress(payload).catch(() => undefined)
    },
    ask: async (input: Record<string, unknown>): Promise<void> => {
      if (!deps.assertPermission) return
      await deps.assertPermission(input)
    },
  }
}

function toInputSchema(name: string, args: ToolDefinition["args"]): unknown | undefined {
  try {
    const { $schema, ...jsonSchema } = z.toJSONSchema(z.object(args), { io: "input" })
    return jsonSchema
  } catch (error) {
    log("[matrixx] tool schema conversion failed", {
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export function toV2Tool(
  name: string,
  definition: ToolDefinition,
  deps: ToolBridgeDeps,
): V2ToolInfo | undefined {
  const input = toInputSchema(name, definition.args)
  if (input === undefined) return undefined
  const options = REGISTRATION_OPTIONS[name]
  return {
    name,
    description: definition.description,
    input,
    ...(options === undefined ? {} : { options }),
    execute: async (rawInput: unknown, context: V2ToolContext): Promise<V2ToolResult> => {
      const result = await definition.execute(
        rawInput as never,
        buildV1ToolContext(context, deps) as never,
      )
      return normalizeResult(result)
    },
  }
}

export function toV2Tools(tools: ToolsRecord, deps: ToolBridgeDeps): V2ToolInfo[] {
  const converted: V2ToolInfo[] = []
  for (const [name, definition] of Object.entries(tools)) {
    const tool = toV2Tool(name, definition, deps)
    if (tool) converted.push(tool)
  }
  return converted
}
