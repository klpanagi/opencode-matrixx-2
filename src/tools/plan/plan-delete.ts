import { existsSync, unlinkSync } from "node:fs"
import { z } from "zod"
import type { MatrixxContext } from "../../plugin/context"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { resolveDirectory, validatePlanFilePath } from "./types"

export function createPlanDeleteTool(ctx?: MatrixxContext): MatrixxToolDefinition {
  return defineTool("plan_delete", {
    description: `Delete a plan file under .matrixx/plans/*.md. Scoped unlink inside PLANS_DIR, refuses outside paths.`,
    args: {
      filePath: z.string().describe("Path to plan file to delete (must be inside .matrixx/plans, kebab-case .md)"),
    },
    execute: async (args, context) => {
      try {
        const filePath = args.filePath as string
        const directory = resolveDirectory(context, ctx)
        const validation = validatePlanFilePath(filePath, directory)
        if ("error" in validation) {
          return JSON.stringify({ error: "invalid_file_path", message: validation.error, stateRoot: directory })
        }
        const resolved = validation.resolved
        if (!existsSync(resolved)) {
          return JSON.stringify({ error: "file_not_found", message: `File not found: ${resolved}`, resolved, stateRoot: directory })
        }
        unlinkSync(resolved)
        return JSON.stringify({ success: true, filePath: resolved, message: `Deleted ${resolved}` })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify({ error: "internal_error", message })
      }
    },
  })
}
