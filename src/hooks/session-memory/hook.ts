import type { NativeMemoryConfig } from "../../config/schema/memory"
import { appendMemoryEntry, isSyntheticMessage, type MemoryEntryInput } from "../../features/session-memory"
import type { MatrixxContext, V2Event } from "../../plugin/context"
import { notifyInjection } from "../../shared/injection-notifier"
import { log } from "../../shared/logger"

const HOOK_NAME = "session-memory"

export const MAX_PENDING_ENTRIES = 50

export const MAX_CAPTURE_CHARS = 2000

export interface SessionMemoryHookOptions {
  memory?: NativeMemoryConfig
  directory?: string
}

export interface SessionMemoryHook {
  "tool.execute.after": (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => Promise<void>
  event: (event: V2Event) => Promise<void>
  flush: (sessionID: string) => void
  pendingCount: () => number
}

function isIgnoredTool(toolName: string, ignoreToolPrefixes: string[]): boolean {
  return ignoreToolPrefixes.some((prefix) => toolName.startsWith(prefix))
}

function hashSnippet(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

export function createSessionMemoryHook(
  ctx: MatrixxContext,
  options: SessionMemoryHookOptions = {},
): SessionMemoryHook {
  const enabled = options.memory?.enabled ?? false
  const directory = options.directory ?? ctx.directory
  const ignoreToolPrefixes = options.memory?.ignoreToolPrefixes ?? ["ctx_"]
  const pending: MemoryEntryInput[] = []
  let doubleCaptureWarned = false

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ): Promise<void> => {
    if (!enabled) return
    if (
      !doubleCaptureWarned &&
      (input.tool.startsWith("lcm_") || input.tool.startsWith("supermemory"))
    ) {
      doubleCaptureWarned = true
      log(
        `[${HOOK_NAME}] Double-capture risk: external tool "${input.tool}" observed while the native backend is active. Pick one backend — memory.backend="native" XOR "lcm" / "supermemory".`,
      )
    }
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
    if (due.length > 0) {
      void notifyInjection(ctx, {
        sessionID,
        injector: "session-memory",
        hash: hashSnippet(due.map((entry) => entry.text).join("|").slice(0, 4000)),
        title: "Context injection",
        message: "Session memory saved",
      })
    }
  }

  const event = async (event: V2Event): Promise<void> => {
    if (!enabled) return
    if (event.type !== "session.idle" && event.type !== "session.compacted") return
    const props = event.data as Record<string, unknown> | undefined
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
