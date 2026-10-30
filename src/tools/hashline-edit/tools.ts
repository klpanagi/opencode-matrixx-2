import { z } from "zod"
import { defineTool, type MatrixxToolContext, type MatrixxToolDefinition } from "../shared/define-tool"
import { executeHashlineEditTool } from "./hashline-edit-executor"
import type { RawHashlineEdit } from "./normalize-edits"
import { HASHLINE_EDIT_DESCRIPTION } from "./tool-description"

interface HashlineEditArgs {
  filePath: string
  edits: RawHashlineEdit[]
  delete?: boolean
  rename?: string
}

function isPlansPath(filePath: string): boolean {
  return filePath.toLowerCase().replace(/\\/g, "/").includes(".matrixx/plans")
}

export function createHashlineEditTool(): MatrixxToolDefinition {
  return defineTool("edit", {
    description: HASHLINE_EDIT_DESCRIPTION,
    args: {
      filePath: z.string().describe("Absolute path to the file to edit"),
      delete: z.boolean().optional().describe("Delete file instead of editing"),
      rename: z.string().optional().describe("Rename output file path after edits"),
      edits: z
        .array(
          z.object({
            op: z
              .union([
                z.literal("replace"),
                z.literal("append"),
                z.literal("prepend"),
              ])
              .describe("Hashline edit operation mode"),
            pos: z.string().optional().describe("Primary anchor in LINE#ID format"),
            end: z.string().optional().describe("Range end anchor in LINE#ID format"),
            lines: z
              .union([z.array(z.string()), z.string(), z.null()])
              .describe("Replacement or inserted lines as newline-delimited string. null deletes with replace"),
          })
        )
        .describe("Array of edit operations to apply (empty when delete=true)"),
    },
    execute: async (args: HashlineEditArgs, context: MatrixxToolContext) => {
      if (isPlansPath(args.filePath) || (args.rename !== undefined && isPlansPath(args.rename))) {
        throw new Error(
          "Blocked: hashline-edit cannot modify files inside .matrixx/plans. " +
            "Use plan_update for plan file edits (LINE#ID anchors supported) and plan_read for reading plan files."
        )
      }
      return executeHashlineEditTool(args, context)
    },
  })
}
