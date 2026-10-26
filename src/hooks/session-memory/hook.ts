import type { PluginInput } from "@opencode-ai/plugin"
import type { MemoryConfig } from "../../config/schema/memory"
import { appendMemoryEntry, isSyntheticMessage, type MemoryEntryInput } from "../../features/session-memory"
import { log } from "../../shared/logger"

const HOOK_NAME = "session-memory"

/** In-memory staging cap — bounds hot-path memory, never grows unbounded. */
export const MAX_PENDING_ENTRIES = 50

/** Per-entry text cap in the hot path — full budgets apply at recall/render. */
export const MAX_CAPTURE_CHARS = 2000

export interface SessionMemoryHookOptions {
  memory?: MemoryConfig
  directory?: string
}

export interface SessionMemoryHook {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => Promise<void>
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  flush: (sessionID: string) => void
  pendingCount: () => number
}

function isIgnoredTool(toolName: string, ignoreToolPrefixes: string[]): boolean {
  return ignoreToolPrefixes.some((prefix) => toolName.startsWith(prefix))
}

/**
 * Light session-memory hook (PostToolUse + event only).
 *
 * Hot path (`tool.execute.after`) does NO JSONL read/write — it stages
 * entries in a bounded in-memory buffer. Flush to disk happens only on
 * `session.idle` / `session.compacted` events (off the hot path).
 *
 * Disabled (`memory.enabled !== true`) = no-op handlers, never throws.
 */
export function createSessionMemoryHook(
  ctx: PluginInput,
  options: SessionMemoryHookOptions = {},
): SessionMemoryHook {
  const enabled = options.memory?.enabled ?? false
  const directory = options.directory ?? ctx.directory
  const ignoreToolPrefixes = options.memory?.ignoreToolPrefixes ?? ["ctx_"]
  const pending: MemoryEntryInput[] = []

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ): Promise<void> => {
    if (!enabled) return
    if (isIgnoredTool(input.tool, ignoreToolPrefixes)) return
    const text = (output.output ?? "").trim()
    if (!text) return
    if (isSyntheticMessage(text)) return
    if (pending.length >= MAX_PENDING_ENTRIES) pending.shift()
    pending.push({
      id: input.callID,
      sessionId: input.sessionID,
      messageId: input.callID,
      scope: "session",
      pinned: false,
      removed: false,
      text: text.length > MAX_CAPTURE_CHARS ? text.slice(0, MAX_CAPTURE_CHARS) : text,
    })
  }

  const flush = (sessionID: string): void => {
    if (!enabled) return
    const due = pending.filter((entry) => entry.sessionId === sessionID)
    for (const entry of due) {
      try {
        appendMemoryEntry(entry, directory)
      } catch (error) {
        log(`[${HOOK_NAME}] Flush failed`, { error })
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i]?.sessionId === sessionID) pending.splice(i, 1)
    }
  }

  const event = async ({
    event: evt,
  }: {
    event: { type: string; properties?: unknown }
  }): Promise<void> => {
    if (!enabled) return
    if (evt.type !== "session.idle" && evt.type !== "session.compacted") return
    const props = evt.properties as Record<string, unknown> | undefined
    const sessionID =
      (props?.sessionID as string | undefined) ??
      ((props?.info as { id?: string } | undefined)?.id as string | undefined)
    if (!sessionID) return
    flush(sessionID)
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event,
    flush,
    pendingCount: () => pending.length,
  }
}
