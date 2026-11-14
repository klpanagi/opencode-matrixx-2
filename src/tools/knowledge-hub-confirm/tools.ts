import { existsSync } from "node:fs"
import * as path from "node:path"
import { z } from "zod"
import type { LoadedHub } from "../../features/knowledge-hub/loader"
import { approveHubWrite, HUB_WRITE_APPROVAL_TTL_MS } from "../../hooks/knowledge-hub-guard/approvals"
import type { MatrixxContext } from "../../plugin/tool/context"
import { log } from "../../shared/runtime/logger"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"

const HOOK_NAME = "knowledge-hub-guard"

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * `knowledge_hub_confirm` tool — records a user-confirmed override for the
 * knowledge-hub read-only guard.
 *
 * Call this ONLY after the user explicitly approved the write via the
 * question tool. It validates that the target is an existing path inside a
 * configured hub and that the caller is the active session, then records a
 * session-scoped approval (default TTL 10 min) for the exact absolute path.
 * Refusals are returned as strings: the tool result has no error variant.
 */
export function createKnowledgeHubConfirmTool(
  ctx: MatrixxContext,
  deps: { getHubs: () => LoadedHub[] },
): MatrixxToolDefinition {
  return defineTool("knowledge_hub_confirm", {
    description:
      "Record user confirmation for a knowledge-hub write. Call only after the user " +
      "explicitly approved the write via the question tool. Records a session-scoped " +
      "approval (10 min TTL) for the exact path, then retry the blocked write.",
    args: {
      path: z
        .string()
        .describe("Hub file or directory the user approved for writing (absolute or relative to the project dir)"),
      sessionID: z
        .string()
        .optional()
        .describe("Session the approval applies to (defaults to the current session)"),
    },
    async execute(args, context): Promise<string> {
      const raw = args.path as string
      const requestedSession = args.sessionID as string | undefined
      if (requestedSession !== undefined && requestedSession !== context.sessionID) {
        log(`[${HOOK_NAME}] hub write confirmation refused: session mismatch`, {
          requestedSession,
          sessionID: context.sessionID,
          path: raw,
        })
        return `Refused hub write: sessionID "${requestedSession}" does not match the active session. No approval recorded.`
      }
      const base = ctx.directory ?? context.directory
      const resolved = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(base, raw)
      let hubs: LoadedHub[]
      try {
        hubs = deps.getHubs()
      } catch (error) {
        log(`[${HOOK_NAME}] hub write confirmation refused: hub lookup failed`, {
          path: resolved,
          error: error instanceof Error ? error.message : String(error),
        })
        return `Refused hub write: knowledge-hub configuration is unavailable. No approval recorded.`
      }
      if (!hubs.some((hub) => isInsideRoot(hub.root, resolved))) {
        log(`[${HOOK_NAME}] hub write confirmation refused: outside hub roots`, { path: resolved })
        return `Refused hub write: "${resolved}" is not inside any configured knowledge hub. No approval recorded.`
      }
      if (!existsSync(resolved)) {
        log(`[${HOOK_NAME}] hub write confirmation refused: target missing`, { path: resolved })
        return `Refused hub write: "${resolved}" does not exist. No approval recorded.`
      }
      const sessionID = context.sessionID
      approveHubWrite(sessionID, resolved, HUB_WRITE_APPROVAL_TTL_MS)
      log(`[${HOOK_NAME}] hub write approved by user`, { sessionID, path: resolved })
      return `Approved hub write for "${resolved}" in session "${sessionID}" (valid 10 min). Retry the blocked write now.`
    },
  })
}
