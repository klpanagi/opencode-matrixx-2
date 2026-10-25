/**
 * V1 tool → V2 tool translation.
 *
 * matrixx tools are V1 `ToolDefinition`s (`{ description, args: ZodRawShape,
 * execute(args, context): Promise<string> }`). V2 registers `Tool.Info`s
 * (`{ name, description, input, execute(input, context): Promise<Result> }`)
 * through `ctx.tool.transform`.
 *
 * The zod raw shape is passed as `input` directly: V2 accepts any Standard Schema
 * and zod v4 objects implement it.
 */

import type { ToolDefinition } from "@opencode-ai/plugin"
import { z } from "zod"
import type { V2ToolContext, V2ToolInfo, V2ToolResult } from "./opencode-types"
import type { ToolsRecord } from "./types"

export interface ToolBridgeDeps {
  directory: string
  worktree: string
  assertPermission?: (input: Record<string, unknown>) => Promise<void>
  context?: unknown
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
      const payload: Record<string, unknown> = { ...(input.metadata ?? {}) }
      if (input.title !== undefined) payload.title = input.title
      void context.progress(payload).catch(() => undefined)
    },
    ask: async (input: Record<string, unknown>): Promise<void> => {
      if (!deps.assertPermission) return
      await deps.assertPermission(input)
    },
  }
}

export function toV2Tool(name: string, definition: ToolDefinition, deps: ToolBridgeDeps): V2ToolInfo {
  const input = z.object(definition.args)
  return {
    name,
    description: definition.description,
    input,
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
  return Object.entries(tools).map(([name, definition]) => toV2Tool(name, definition, deps))
}
