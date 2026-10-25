/**
 * MCP domain entrypoint — thin composer over the pure `./mcp.transform` core.
 *
 * `createBuiltinMcps` keeps the V1 `config`-handler contract (lazy websearch
 * construction, injectable availability check) and delegates every entry to
 * `buildBuiltinMcpEntries` / `buildWebsearchEntry`. New code should prefer the
 * pure builder plus `registerMcpTransform` directly.
 */

import type { MatrixxConfig } from "../config/schema"
import {
  type BuildBuiltinMcpEntriesResult,
  type BuiltinMcpEntry,
  buildBuiltinMcpEntries,
  buildWebsearchEntry,
} from "./mcp.transform"
import { isCommandAvailable, type McpCreationFailure } from "./mcp-validator"

export type {
  McpTransformDomain,
  McpTransformEditor,
  RegisterMcpTransformResult,
} from "./mcp.transform"
export { type BuiltinMcpEntry, buildBuiltinMcpEntries, buildWebsearchEntry, registerMcpTransform, toV2McpEntry } from "./mcp.transform"
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
  config?: MatrixxConfig,
  options: CreateBuiltinMcpsOptions = {},
): CreateBuiltinMcpsResult {
  const commandAvailable = options.isCommandAvailable ?? isCommandAvailable
  const { entries, failures }: BuildBuiltinMcpEntriesResult = buildBuiltinMcpEntries({
    disabledMcps,
    websearch: config?.websearch,
    uvxAvailable: commandAvailable("uvx"),
  })

  if (!disabledMcps.includes("websearch") && entries.websearch) {
    // Preserve lazy construction: the websearch config is (re)built on first
    // access so a key that appears after startup is picked up and a missing
    // key never throws at plugin-init time.
    let websearchConfig: BuiltinMcpEntry | undefined
    const websearchInput = config?.websearch
    Object.defineProperty(entries, "websearch", {
      enumerable: true,
      configurable: true,
      get() {
        if (!websearchConfig) {
          const result = buildWebsearchEntry(websearchInput)
          if ("entry" in result) {
            websearchConfig = result.entry
          } else {
            if (!failures.some((f) => f.name === "websearch")) {
              failures.push({ name: "websearch", error: result.failure })
            }
            websearchConfig = { type: "remote", url: "", enabled: false, oauth: false }
          }
        }
        return websearchConfig
      },
    })
  }

  return { mcps: entries, failures }
}
