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

export type {
  McpTransformDomain,
  McpTransformEditor,
  RegisterMcpTransformResult,
} from "./mcp.transform"
export { type BuiltinMcpEntry, buildBuiltinMcpEntries, registerMcpTransform, toV2McpEntry } from "./mcp.transform"
export type { McpCreationFailure } from "./mcp-validator"
export { type McpName, McpNameSchema } from "./types"

export interface CreateBuiltinMcpsOptions {
  isCommandAvailable?: (command: string) => boolean
}

export interface CreateBuiltinMcpsResult {
  mcps: Record<string, BuiltinMcpEntry>
  failures: McpCreationFailure[]
}

export function createBuiltinMcps(
  disabledMcps: string[] = [],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config?: MatrixxConfig,
  options: CreateBuiltinMcpsOptions = {},
): CreateBuiltinMcpsResult {
  const commandAvailable = options.isCommandAvailable ?? isCommandAvailable
  const { entries, failures }: BuildBuiltinMcpEntriesResult = buildBuiltinMcpEntries({
    disabledMcps,
    uvxAvailable: commandAvailable("uvx"),
  })

  return { mcps: entries, failures }
}
