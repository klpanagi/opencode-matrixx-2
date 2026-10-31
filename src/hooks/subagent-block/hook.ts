import type { SubagentBlockConfigInput } from "../../config/schema/subagent-block"
import { resolveSubagentBlock } from "../../config/schema/subagent-block"
import type { MatrixxContext } from "../../plugin/context"
import type { Hooks } from "../../plugin/legacy-hooks"
import { log } from "../../shared"
import { BLOCK_MESSAGE, BYPASS_LOG_PREFIX, HOOK_NAME } from "./constants"

export interface SubagentBlockHookOptions {
  readonly allowlist?: readonly string[]
}

/** Structural view of the context shapes that may carry the allowlist. */
interface AllowlistCarrier {
  readonly subagent_block?: SubagentBlockConfigInput | null
  readonly config?: {
    readonly subagent_block?: SubagentBlockConfigInput | null
  } | null
}

export type SubagentBlockContext = MatrixxContext & AllowlistCarrier

function extractAllowlist(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return []
  if (!("allowlist" in input)) return []
  const raw: unknown = input.allowlist
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === "string")
}

function resolveInput(input: SubagentBlockConfigInput | null | undefined): string[] {
  if (input === null || input === undefined) return []
  try {
    return resolveSubagentBlock(input).allowlist
  } catch {
    return extractAllowlist(input)
  }
}

function collectAllowlist(ctx: SubagentBlockContext, options?: SubagentBlockHookOptions): Set<string> {
  const merged: string[] = []
  if (options?.allowlist) merged.push(...options.allowlist)
  merged.push(...resolveInput(ctx.subagent_block))
  merged.push(...resolveInput(ctx.config?.subagent_block))
  return new Set(merged)
}

function identityCandidates(input: { sessionID?: string }, args: Record<string, unknown>): string[] {
  const found: string[] = []
  if (typeof input.sessionID === "string") found.push(input.sessionID)
  if (typeof args === "object" && args !== null) {
    for (const key of ["agent", "subagent_type", "sessionID", "session_id"] as const) {
      if (key in args) {
        const value: unknown = args[key]
        if (typeof value === "string") found.push(value)
      }
    }
  }
  return found
}

export function createSubagentBlockHook(ctx: SubagentBlockContext, options?: SubagentBlockHookOptions): Hooks {
  const allowlist = collectAllowlist(ctx, options)
  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      if (input.tool?.toLowerCase() !== "subagent") return
      const bypass = identityCandidates(input, output.args).some((id) => allowlist.has(id))
      if (bypass) {
        log(`${BYPASS_LOG_PREFIX} session=${input.sessionID}`, {
          hook: HOOK_NAME,
          sessionID: input.sessionID,
          tool: input.tool,
        })
        return
      }
      throw new Error(BLOCK_MESSAGE)
    },
  }
}
