/**
 * V2-native MCP domain transform (D4).
 *
 * Owned by `src/mcps/`: pure entry builder + single `ctx.mcp.transform` registration.
 * The builder performs no filesystem access, no process spawn and no network —
 * environment capability (`uvxAvailable`) is resolved by the caller at the edge
 * and passed in as data, so repeated runs over the same input replay identically.
 */

import type { WebsearchConfig } from "../config/schema"
import { context7 } from "./context7"
import { document_reader } from "./document-reader"
import type { McpCreationFailure } from "./mcp-validator"
import { validateWebsearchConfig } from "./mcp-validator"
import { createWebsearchConfig } from "./websearch"

export type { McpCreationFailure } from "./mcp-validator"

export type BuiltinMcpEntry =
  | {
      type: "remote"
      url: string
      enabled: boolean
      headers?: Record<string, string>
      oauth?: false
    }
  | {
      type: "local"
      command: string[]
      enabled: boolean
    }

export interface BuildBuiltinMcpEntriesInput {
  disabledMcps?: string[]
  websearch?: WebsearchConfig
  /** Resolved by the caller (e.g. `isCommandAvailable("uvx")`); never spawned here. */
  uvxAvailable: boolean
}

export interface BuildBuiltinMcpEntriesResult {
  entries: Record<string, BuiltinMcpEntry>
  failures: McpCreationFailure[]
}

const DISABLED_REMOTE_STUB: BuiltinMcpEntry = {
  type: "remote",
  url: "",
  enabled: false,
  oauth: false,
}

const DISABLED_LOCAL_STUB: BuiltinMcpEntry = {
  type: "local",
  command: [],
  enabled: false,
}

/**
 * Pure websearch entry builder (reads env only, never spawns or writes).
 * Shared by the eager builder below and the lazy V1 composer in `./index`.
 */
export function buildWebsearchEntry(
  websearch?: WebsearchConfig,
): { entry: BuiltinMcpEntry } | { failure: string } {
  const validation = validateWebsearchConfig(websearch)
  if (!validation.ok) {
    return { failure: validation.error }
  }
  try {
    return { entry: createWebsearchConfig(websearch) }
  } catch (err) {
    return { failure: err instanceof Error ? err.message : String(err) }
  }
}

/** Pure: builtin MCP entries + non-fatal failures for a given input. */
export function buildBuiltinMcpEntries(
  input: BuildBuiltinMcpEntriesInput,
): BuildBuiltinMcpEntriesResult {
  const disabledMcps = input.disabledMcps ?? []
  const entries: Record<string, BuiltinMcpEntry> = {}
  const failures: McpCreationFailure[] = []

  if (!disabledMcps.includes("websearch")) {
    const result = buildWebsearchEntry(input.websearch)
    if ("entry" in result) {
      entries.websearch = result.entry
    } else {
      failures.push({ name: "websearch", error: result.failure })
      entries.websearch = DISABLED_REMOTE_STUB
    }
  }

  if (!disabledMcps.includes("context7")) {
    entries.context7 = context7
  }

  if (!disabledMcps.includes("document_reader")) {
    if (input.uvxAvailable) {
      entries.document_reader = document_reader
    } else {
      failures.push({
        name: "document_reader",
        error:
          "uvx (uv package manager) not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh",
      })
      entries.document_reader = DISABLED_LOCAL_STUB
    }
  }

  return { entries, failures }
}

export type V2McpEntry = {
  type: "local" | "remote"
  disabled?: boolean
  [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

/**
 * Pure sanitizer: V1 draft entry (`enabled`, no discriminator) → V2 tagged entry.
 * Fields that would fail the V2 schema (explicit `undefined`, non-object
 * `headers`) are dropped, because a schema defect here disables the whole plugin.
 */
export function toV2McpEntry(entry: unknown): V2McpEntry | undefined {
  const record = asRecord(entry)
  const type =
    record.type ??
    (Array.isArray(record.command) ? "local" : typeof record.url === "string" ? "remote" : undefined)
  if (type !== "local" && type !== "remote") return undefined

  const config: V2McpEntry = { type }
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key === "enabled" || key === "type") continue
    if (key === "headers") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue
      const headers: Record<string, string> = {}
      for (const [header, headerValue] of Object.entries(value)) {
        if (typeof headerValue === "string") headers[header] = headerValue
      }
      config.headers = headers
      continue
    }
    config[key] = value
  }
  if (record.enabled === false) config.disabled = true
  return config
}

/** Minimal structural editor: the real V2 `MCPEditor` satisfies this. */
export interface McpTransformEditor {
  set(name: string, config: unknown): void
}

export interface McpTransformDomain {
  transform(callback: (editor: McpTransformEditor) => void): Promise<unknown>
}

export interface RegisterMcpTransformResult {
  registration: unknown
  /** Entries skipped because they failed V2 sanitization. */
  skipped: string[]
}

/**
 * Pure replay: V1-shaped draft entries → `ctx.mcp.transform`.
 * The only effect is the single `transform` call; the callback itself only
 * calls `editor.set`, so re-running over the same draft replays identically.
 */
export async function registerMcpTransform(
  mcp: McpTransformDomain,
  entries: Record<string, unknown> | undefined,
): Promise<RegisterMcpTransformResult> {
  const skipped: string[] = []
  const registration = await mcp.transform((editor) => {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      const config = toV2McpEntry(entry)
      if (!config) {
        skipped.push(name)
        continue
      }
      editor.set(name, config)
    }
  })
  return { registration, skipped }
}
