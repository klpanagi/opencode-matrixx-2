import { join } from "node:path"
import { z } from "zod"
import type { MatrixxConfig } from "../../config/schema"
import { getTaskDir, readJsonSafe } from "../../features/task-storage/storage"
import type { MatrixxContext } from "../../plugin/context"
import { stateRootFromToolContext } from "../../shared/state-root"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { TASK_ID_PATTERN } from "./constants"
import { TaskGetInputSchema, TaskObjectSchema } from "./types"

function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null
  return id
}

export function createTaskGetTool(config: Partial<MatrixxConfig>, ctx?: MatrixxContext): MatrixxToolDefinition {
  return defineTool("task_get", {
    description: `[TRACKING — local progress record only. Spawns nothing, executes nothing.]
Retrieve a task by ID.

Returns the full task object including all fields: id, subject, description, status, activeForm, blocks, blockedBy, owner, metadata, repoURL, parentID, and threadID.

Returns null if the task does not exist or the file is invalid.`,
    args: {
      id: z.string().describe("Task ID to retrieve (format: T-{uuid})"),
    },
    execute: async (args: Record<string, unknown>, context?: { sessionID: string }): Promise<string> => {
      try {
        const validatedArgs = TaskGetInputSchema.parse(args)
        const taskId = parseTaskId(validatedArgs.id)

        if (!taskId) {
          return JSON.stringify({ error: "invalid_task_id" })
        }

        const directory = stateRootFromToolContext(context, ctx)
        const taskDir = getTaskDir(config, directory)
        const taskPath = join(taskDir, `${taskId}.json`)

         const task = readJsonSafe(taskPath, TaskObjectSchema)

        return JSON.stringify({ task: task ?? null })
      } catch (error) {
        if (error instanceof Error && error.message.includes("validation")) {
          return JSON.stringify({ error: "invalid_arguments" })
        }
        return JSON.stringify({ error: "unknown_error" })
      }
    },
  })
}
