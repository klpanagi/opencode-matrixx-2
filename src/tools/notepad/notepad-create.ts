import { existsSync, mkdirSync } from "node:fs"
import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { atomicWrite } from "../../features/mission-state/plan-storage"
import { renderNotepad } from "../../hooks/task-notepad-writer/constants"
import type { MatrixxContext } from "../../plugin/context"
import { resolveDirectory } from "../plan/types"
import { validateNotepadFilePath } from "./validation"

export function createNotepadCreateTool(ctx?: MatrixxContext): MatrixxToolDefinition {
  return defineTool("notepad_create", {
    description: `Create a notepad file under .matrixx/notepads/<bucket>/<file>.md.\nValidated via validateNotepadFilePath (kebab-case .md, no absolute paths, no .. escape).\nEmpty planName falls back to the adhoc bucket. Refuses to overwrite: file_exists when present.`,
    args: {
      planName: tool.schema.string().optional().describe("Bucket name (kebab-case). Omit for the adhoc bucket"),
      fileName: tool.schema.string().describe("Notepad file name (kebab-case .md, directly inside the bucket)"),
      subject: tool.schema.string().optional().describe("Task subject for the notepad header (defaults to the file name)"),
      taskId: tool.schema.string().optional().describe("Task ID for the **Task ID** marker line (defaults to <bucket>/<file>)"),
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
        const { resolved, bucketDir, bucket } = validation
        mkdirSync(bucketDir, { recursive: true })
        if (existsSync(resolved)) {
          return JSON.stringify({
            error: "file_exists",
            message: `Notepad already exists: ${resolved}. Use notepad_read to inspect it or notepad_append to extend it.`,
            filePath: resolved,
          })
        }
        const stem = fileName.slice(0, -".md".length)
        const subject = typeof args.subject === "string" && args.subject.trim() !== ""
          ? args.subject
          : stem
        const taskId = typeof args.taskId === "string" && args.taskId.trim() !== ""
          ? args.taskId
          : `${bucket}/${stem}`
        const content = renderNotepad({
          subject,
          taskId,
          startedAt: new Date().toISOString(),
        })
        const ok = atomicWrite(resolved, content)
        if (!ok) {
          return JSON.stringify({ error: "write_failed", message: `Failed to write ${resolved}` })
        }
        return JSON.stringify({
          success: true,
          filePath: resolved,
          message: `Created notepad ${resolved}`,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify({ error: "internal_error", message })
      }
    },
  })
}
