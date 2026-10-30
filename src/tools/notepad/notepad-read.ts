import { existsSync, readFileSync } from "node:fs"
import { type MatrixxToolDefinition, tool } from "@opencode-ai/plugin/tool"
import type { MatrixxContext } from "../../plugin/context"
import { selectLines } from "../plan/plan-read-pagination"
import { resolveDirectory } from "../plan/types"
import { NOTEPAD_ERROR_CODES } from "./constants"
import { validateNotepadFilePath } from "./validation"

export function createNotepadReadTool(ctx?: MatrixxContext): MatrixxToolDefinition {
  return tool({
    description: `Read a notepad file from .matrixx/notepads/<bucket>/<file>.md (utf-8).\nValidated via validateNotepadFilePath. Missing file returns not_found. Paginate with offset (1-based) / limit.`,
    args: {
      planName: tool.schema.string().optional().describe("Bucket name (kebab-case). Omit for the adhoc bucket"),
      fileName: tool.schema.string().describe("Notepad file name (kebab-case .md, directly inside the bucket)"),
      offset: tool.schema
        .number()
        .optional()
        .describe("1-based start line (inclusive) for pagination; omit for whole file"),
      limit: tool.schema
        .number()
        .optional()
        .describe("Number of lines to return from offset; omit to read to end of file"),
    },
    execute: async (args, context) => {
      try {
        const planName = args.planName as string | undefined
        const fileName = args.fileName as string
        const directory = resolveDirectory(context, ctx)
        const validation = validateNotepadFilePath(fileName, planName, directory)
        if ("error" in validation) {
          return JSON.stringify({ error: validation.error, message: validation.message })
        }
        const resolved = validation.resolved
        if (!existsSync(resolved)) {
          return JSON.stringify({
            error: NOTEPAD_ERROR_CODES.notFound,
            message: `Notepad not found: ${resolved}`,
          })
        }
        const content = readFileSync(resolved, "utf-8")
        const paginated = args.offset !== undefined || args.limit !== undefined
        if (!paginated) {
          return JSON.stringify({ filePath: resolved, content })
        }
        const selection = selectLines(
          content.split("\n"),
          args.offset as number | undefined,
          args.limit as number | undefined,
        )
        if ("argument" in selection) {
          return JSON.stringify({
            error: "validation_error",
            argument: selection.argument,
            message: selection.message,
          })
        }
        return JSON.stringify({
          filePath: resolved,
          content: selection.selected.join("\n"),
          offset: args.offset,
          limit: args.limit,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify({ error: "internal_error", message })
      }
    },
  })
}
