import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { z } from "zod"
import type { MatrixxContext } from "../../plugin/context"
import { resolveDirectory } from "../plan/types"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { NOTEPAD_ERROR_CODES } from "./constants"
import { validateNotepadFilePath } from "./validation"

export const MAX_NOTEPAD_APPEND_BYTES = 40_000

export function createNotepadAppendTool(ctx?: MatrixxContext): MatrixxToolDefinition {
  return defineTool("notepad_append", {
    description: "Append a timestamped section to an existing notepad file under .matrixx/notepads/<bucket>/*.md. APPEND-only via appendFileSync — never overwrites, never auto-creates (missing file returns not_found).",
    args: {
      planName: z.string().optional().describe("Bucket/plan name (kebab-case); empty falls back to adhoc"),
      fileName: z.string().describe("Notepad file name (kebab-case .md, directly inside bucket)"),
      content: z.string().describe("Markdown content to append (non-empty, max 40k bytes)"),
      taskId: z.string().optional().describe("Task ID for the section heading"),
    },
    execute: async (args, context) => {
      try {
        const planName = args.planName as string | undefined
        const fileName = args.fileName as string
        const content = args.content as string
        const taskId = args.taskId as string | undefined
        if (typeof content !== "string" || content.trim() === "") {
          return JSON.stringify({ error: "validation_error", message: "content is required and must be non-empty" })
        }
        const contentBytes = Buffer.byteLength(content, "utf-8")
        if (contentBytes > MAX_NOTEPAD_APPEND_BYTES) {
          return JSON.stringify({
            error: "size_exceeded",
            message: `content is ${contentBytes} bytes, exceeding the ${MAX_NOTEPAD_APPEND_BYTES}-byte append cap`,
            hint: "Split the content into smaller appends.",
          })
        }
        const directory = resolveDirectory(context, ctx)
        const validation = validateNotepadFilePath(fileName, planName ?? null, directory)
        if ("error" in validation) {
          return JSON.stringify({ error: validation.error, message: validation.message })
        }
        const resolved = validation.resolved
        if (!existsSync(resolved)) {
          return JSON.stringify({
            error: NOTEPAD_ERROR_CODES.notFound,
            message: `Notepad file not found: ${resolved}. Create it with notepad_create first.`,
            filePath: resolved,
          })
        }
        try {
          readFileSync(resolved, "utf-8")
        } catch {
          return JSON.stringify({
            error: NOTEPAD_ERROR_CODES.notFound,
            message: `Notepad file not readable: ${resolved}`,
            filePath: resolved,
          })
        }
        const iso = new Date().toISOString()
        const heading = taskId && taskId.trim() !== "" ? `## ${iso} Task: ${taskId}` : `## ${iso}`
        const section = `\n${heading}\n\n${content}\n`
        appendFileSync(resolved, section, "utf-8")
        const bytesAppended = Buffer.byteLength(section, "utf-8")
        return JSON.stringify({ success: true, filePath: resolved, bytesAppended })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify({ error: "internal_error", message })
      }
    },
  })
}
