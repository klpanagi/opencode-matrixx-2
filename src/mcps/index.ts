/**
 * MCP domain entrypoint — thin composer over the pure `./mcp.transform` core.
 *
 * `createBuiltinMcps` keeps the injectable availability check and delegates
 * every entry to `buildBuiltinMcpEntries`. New code should prefer the
 * pure builder plus `registerMcpTransform` directly.
 */

import type { MatrixxConfig } from "../config/schema"
import {
  type BuildBuiltinMcpEntriesResult,
  type BuiltinMcpEntry,
  buildBuiltinMcpEntries,
} from "./mcp.transform"
import { isCommandAvailable, type McpCreationFailure } from "./mcp-validator"

export type { Context7HealthInput } from "./context7-health"
export { buildContext7HealthNotice, CONTEXT7_API_KEY_ENV } from "./context7-health"
export type {
  McpTransformDomain,
  McpTransformEditor,
  RegisterMcpTransformResult,
} from "./mcp.transform"
export {
  type BuiltinMcpEntry,
  buildBuiltinMcpEntries,
  DOCUMENT_READER_DISABLED_NOTICE,
  registerMcpTransform,
  toV2McpEntry,
} from "./mcp.transform"
export { buildMcpStartupNotice, getMcpStartupNotice, MCP_UVX_INSTALL_FIX, MCP_UVX_WARM_FIX } from "./mcp-startup-notice"
export { getMcpStartupWarnings, setMcpStartupWarnings } from "./mcp-startup-state"
export type { McpCreationFailure } from "./mcp-validator"
export { isCommandAvailable } from "./mcp-validator"
export type { BuiltinMcpToolNamesInput } from "./tool-names"
export {
  BUILTIN_MCP_TOOL_NAMES,
  CONTEXT7_QUERY_DOCS,
  CONTEXT7_RESOLVE_LIBRARY_ID,
  DOCUMENT_READER_CONVERT_TO_MARKDOWN,
  getBuiltinMcpToolNames,
} from "./tool-names"
export { type McpName, McpNameSchema } from "./types"

export interface CreateBuiltinMcpsOptions {
  isCommandAvailable?: (command: string) => boolean
  /** Overrides `process.env.CONTEXT7_API_KEY`; resolved at the edge, never in the builder. */
  context7ApiKey?: string
}

export interface CreateBuiltinMcpsResult {
  mcps: Record<string, BuiltinMcpEntry>
  failures: McpCreationFailure[]
  /** One-line notices (e.g. document_reader omitted because it is off by default). */
  notices: string[]
}

export function createBuiltinMcps(
  disabledMcps: string[] = [],
  config?: MatrixxConfig,
  options: CreateBuiltinMcpsOptions = {},
): CreateBuiltinMcpsResult {
  const commandAvailable = options.isCommandAvailable ?? isCommandAvailable
  const context7ApiKey = options.context7ApiKey ?? process.env.CONTEXT7_API_KEY ?? undefined
  const { entries, failures, notices }: BuildBuiltinMcpEntriesResult = buildBuiltinMcpEntries({
    disabledMcps,
    uvxAvailable: commandAvailable("uvx"),
    context7ApiKey: context7ApiKey || undefined,
    documentReader: config?.security?.document_reader,
  })

  return { mcps: entries, failures, notices }
}
