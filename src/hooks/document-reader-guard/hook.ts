import type { MatrixxContext } from "../../plugin/tool/context"
import type { Hooks } from "../../plugin/tool/legacy-hooks"

import { log } from "../../shared"
import { isShellTool } from "../../shared/io/shell-tool-name"
import {
  BASH_BLOCK_MESSAGE,
  BINARY_EXTENSIONS,
  BLOCKED_PATTERNS,
  DOCUMENT_READER_TOOL_PATTERN,
  HOOK_NAME,
  READ_BLOCK_MESSAGE,
} from "./constants"
import { evaluateDocumentReaderUri } from "./uri-guard"

const URI_ARG_KEYS = ["uri", "path", "filePath", "source"] as const

function getFilePath(args: Record<string, unknown>): string | undefined {
  const raw = args?.filePath ?? args?.path ?? args?.file
  return typeof raw === "string" ? raw : undefined
}

function getUriArg(args: Record<string, unknown>): string | undefined {
  for (const key of URI_ARG_KEYS) {
    const raw = args?.[key]
    if (typeof raw === "string" && raw.length > 0) return raw
  }
  return undefined
}

function isBinaryDocument(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, "/").split("?")[0].split("#")[0]
  return (BINARY_EXTENSIONS as readonly string[]).some((ext) => normalized.endsWith(ext))
}

export function createDocumentReaderGuardHook(ctx: MatrixxContext): Hooks {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string },
    ): Promise<void> => {
      const tool = input.tool?.toLowerCase()

      if (tool !== undefined && DOCUMENT_READER_TOOL_PATTERN.test(tool)) {
        const uri = getUriArg(output.args as unknown as Record<string, unknown>)
        if (uri) {
          const workspaceRoot = ctx.worktree || ctx.directory
          const blockMessage = evaluateDocumentReaderUri(uri, workspaceRoot)
          if (blockMessage) {
            log(`[${HOOK_NAME}] BLOCKED document_reader URI`, {
              sessionID: input.sessionID,
              tool: input.tool,
              uri: uri.slice(0, 200),
            })
            throw new Error(blockMessage)
          }
        }
        return
      }

      if (tool !== "read" && !isShellTool(tool)) return

      if (tool === "read") {
        const filePath = getFilePath(output.args as unknown as Record<string, unknown>)
        if (!filePath || !isBinaryDocument(filePath)) return
        log(`[${HOOK_NAME}] BLOCKED generic Read on binary document — use document_reader MCP`, {
          sessionID: input.sessionID,
          tool: input.tool,
          filePath,
        })
        throw new Error(READ_BLOCK_MESSAGE)
      }

      const args = output.args as unknown as Record<string, unknown>
      const cmd = args?.command as string | undefined
      if (!cmd) return
      if (!BLOCKED_PATTERNS.some((rx) => rx.test(cmd))) return

      void ctx.directory
      log(`[${HOOK_NAME}] BLOCKED bash document read`, {
        sessionID: input.sessionID,
        command: cmd.slice(0, 120),
      })
      throw new Error(BASH_BLOCK_MESSAGE)
    },
  }
}
