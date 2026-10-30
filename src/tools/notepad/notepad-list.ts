import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import type { MatrixxContext } from "../../plugin/context"
import { resolveDirectory } from "../plan/types"
import {
  MATRIXX_DIR_NAME,
  NOTEPAD_FILENAME_KEBAB_REGEX,
  NOTEPADS_SUBDIR,
} from "./constants"
import { validateBucketName } from "./validation"

export function createNotepadListTool(ctx?: MatrixxContext): MatrixxToolDefinition {
  return defineTool("notepad_list", {
    description: "List notepad buckets under .matrixx/notepads/ (no args) or *.md files inside a bucket (planName). File entries carry mtime/size, mirroring plan_list.",
    args: {
      planName: tool.schema.string().optional().describe("Bucket/plan name (kebab-case); omit to list buckets"),
    },
    execute: async (args, context) => {
      try {
        const planName = args.planName as string | undefined
        const directory = resolveDirectory(context, ctx)
        const root = resolve(join(directory, MATRIXX_DIR_NAME, NOTEPADS_SUBDIR))
        if (planName === undefined || planName === null || planName === "") {
          if (!existsSync(root)) return JSON.stringify({ buckets: [] })
          let names: string[]
          try {
            names = readdirSync(root, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => e.name)
          } catch {
            return JSON.stringify({ buckets: [] })
          }
          const buckets = names
            .sort()
            .map((bucket) => {
              const bucketDir = join(root, bucket)
              let fileCount = 0
              try {
                fileCount = readdirSync(bucketDir).filter((f) => f.endsWith(".md")).length
              } catch {
                fileCount = 0
              }
              return { bucket, bucketDir, fileCount }
            })
          return JSON.stringify({ buckets })
        }
        const bucket = validateBucketName(planName)
        if ("error" in bucket) {
          return JSON.stringify({ error: bucket.error, message: bucket.message })
        }
        const bucketDir = join(root, bucket.bucket)
        if (!existsSync(bucketDir)) return JSON.stringify({ files: [] })
        const allNames = readdirSync(bucketDir).filter((f) => f.endsWith(".md"))
        const files: string[] = []
        const skipped: Array<{ name: string; reason: string }> = []
        for (const name of allNames) {
          if (NOTEPAD_FILENAME_KEBAB_REGEX.test(name)) {
            files.push(name)
            continue
          }
          skipped.push({
            name,
            reason: `Not listed: notepad filename "${name}" does not satisfy the kebab-case rule (NOTEPAD_FILENAME_KEBAB_REGEX, /^[a-z0-9-]+\\.md$/).`,
          })
        }
        const entries = files
          .map((fileName) => {
            const filePath = join(bucketDir, fileName)
            try {
              const stat = statSync(filePath)
              return {
                fileName,
                filePath,
                mtime: stat.mtime.toISOString(),
                mtimeMs: stat.mtimeMs,
                size: stat.size,
              }
            } catch {
              return null
            }
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
        return skipped.length > 0
          ? JSON.stringify({ files: entries, skipped })
          : JSON.stringify({ files: entries })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify({ error: "internal_error", message })
      }
    },
  })
}
