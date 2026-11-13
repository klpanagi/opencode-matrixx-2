/**
 * Canonical builtin MCP tool names.
 *
 * OpenCode v2 registers MCP tools as `${namespace}_${normalizedName}`: a SINGLE
 * underscore between the server namespace and the tool name. This module is the
 * single source of truth so prompts, guards, skills, and tests never drift back
 * to stale names (`document_reader__convert_to_markdown`,
 * `context7_get-library-docs`).
 */

import type { McpName } from "./types"

export const CONTEXT7_RESOLVE_LIBRARY_ID = "context7_resolve-library-id"
export const CONTEXT7_QUERY_DOCS = "context7_query-docs"
export const DOCUMENT_READER_CONVERT_TO_MARKDOWN =
  "document_reader_convert_to_markdown"

export const BUILTIN_MCP_TOOL_NAMES: Record<McpName, readonly string[]> = {
  context7: [CONTEXT7_RESOLVE_LIBRARY_ID, CONTEXT7_QUERY_DOCS],
  document_reader: [DOCUMENT_READER_CONVERT_TO_MARKDOWN],
}

export interface BuiltinMcpToolNamesInput {
  disabledMcps?: readonly string[]
  uvxAvailable?: boolean
}

export function getBuiltinMcpToolNames(
  input: BuiltinMcpToolNamesInput = {},
): string[] {
  const disabled = new Set(input.disabledMcps ?? [])
  const names: string[] = []

  if (!disabled.has("context7")) {
    names.push(...BUILTIN_MCP_TOOL_NAMES.context7)
  }
  if (!disabled.has("document_reader") && input.uvxAvailable === true) {
    names.push(...BUILTIN_MCP_TOOL_NAMES.document_reader)
  }

  return names
}
