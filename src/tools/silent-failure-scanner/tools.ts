import { isAbsolute, join } from "node:path"
import { z } from "zod"
import type { MatrixxContext } from "../../plugin/context"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { DEFAULT_GLOBS, SILENT_FAILURE_SCAN_DESCRIPTION } from "./constants"
import { scanPath } from "./scanner"
import type { ScanSeverity, SilentFailureScanResult } from "./types"

function errorResult(message: string): SilentFailureScanResult {
  return {
    status: 2,
    findings: [],
    summary: { filesScanned: 0, total: 0, errors: 0, warnings: 0, byRule: {}, waived: 0, waivedByRule: {}, stale: 0, note: message } as SilentFailureScanResult["summary"],
    waived: [],
    staleWaivers: [],
    waiverWarnings: [],
  }
}

export function createSilentFailureScannerTool(ctx: MatrixxContext): Record<string, MatrixxToolDefinition> {
  const silent_failure_scan: MatrixxToolDefinition = defineTool("silent_failure_scan", {
    description: SILENT_FAILURE_SCAN_DESCRIPTION,
    args: {
      path: z
        .string()
        .describe("File or directory to scan (absolute, or relative to the project directory)."),
      globs: z
        .array(z.string())
        .optional()
        .describe(`Glob filters when path is a directory (default: ${DEFAULT_GLOBS.join(", ")}).`),
      severity: z
        .enum(["warn", "error"])
        .optional()
        .describe("Minimum severity to report (default: warn)."),
      waivers: z
        .string()
        .optional()
        .describe(
          "Project-relative or absolute path to a COMMITTED waiver JSON file (never under gitignored .matrixx/). Findings matching rule+file+symbol are excluded from status but reported in `waived`.",
        )
    },
    async execute(args) {
      try {
        const base = ctx.directory
        const target = isAbsolute(args.path) ? args.path : join(base, args.path)
        const result = scanPath({
          base,
          target,
          globs: args.globs,
          threshold: args.severity as ScanSeverity | undefined,
          waivers: args.waivers as string | undefined,
        })
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify(errorResult(`silent_failure_scan failed: ${message}`), null, 2)
      }
    },
  })

  return { silent_failure_scan }
}
