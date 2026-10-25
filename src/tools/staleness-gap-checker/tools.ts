import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { analyzeSamples, parseNdjson } from "./checker"
import { STALENESS_GAP_CHECK_DESCRIPTION } from "./constants"
import type { StalenessResult } from "./types"

function errorResult(message: string): StalenessResult {
  return {
    status: 2,
    gaps: [],
    staleness: [],
    summary: {
      samples: 0,
      groups: 0,
      gaps: 0,
      regressions: 0,
      duplicates: 0,
      stale: 0,
      warn: 0,
      healthy: 0,
      note: message,
    },
  }
}

const timestampSchema = tool.schema.union([tool.schema.number(), tool.schema.string()])

export function createStalenessGapCheckerTool(ctx: PluginInput): Record<string, ToolDefinition> {
  const staleness_gap_check: ToolDefinition = tool({
    description: STALENESS_GAP_CHECK_DESCRIPTION,
    args: {
      samples: tool.schema
        .array(
          tool.schema.object({
            symbol: tool.schema.string(),
            exchange: tool.schema.string(),
            seq: tool.schema.number(),
            exchange_ts: timestampSchema,
            pub_ts: timestampSchema.optional(),
          }),
        )
        .optional()
        .describe("In-memory samples. Provide this or logPath."),
      logPath: tool.schema
        .string()
        .optional()
        .describe("Path to a newline-delimited JSON file of samples (absolute or project-relative)."),
      maxGapMultiplier: tool.schema
        .number()
        .optional()
        .describe("Multiplier of the expected interval above which staleness is a warning (default 2)."),
      now: tool.schema
        .number()
        .optional()
        .describe("Reference time in epoch ms for staleness (default: max pub_ts in the input)."),
    },
    async execute(args) {
      try {
        let samples = args.samples ?? []
        let invalidLines = 0
        if (samples.length === 0 && args.logPath) {
          const target = isAbsolute(args.logPath) ? args.logPath : join(ctx.directory, args.logPath)
          if (!existsSync(target)) {
            return JSON.stringify(errorResult(`logPath not found: ${args.logPath}`), null, 2)
          }
          const parsed = parseNdjson(readFileSync(target, "utf8"))
          samples = parsed.samples
          invalidLines = parsed.invalid
        }
        if (samples.length === 0) {
          return JSON.stringify(errorResult("provide samples[] or logPath"), null, 2)
        }

        const result = analyzeSamples(samples, {
          maxGapMultiplier: args.maxGapMultiplier,
          now: args.now,
        })
        if (invalidLines > 0) result.summary.invalidLines = invalidLines
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify(errorResult(`staleness_gap_check failed: ${message}`), null, 2)
      }
    },
  })

  return { staleness_gap_check }
}
