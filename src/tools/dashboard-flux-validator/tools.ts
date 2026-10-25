import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { type ToolDefinition, tool } from "@opencode-ai/plugin/tool"
import { DASHBOARD_FLUX_VALIDATE_DESCRIPTION } from "./constants"
import type { FluxValidationResult } from "./types"
import { validateDashboard } from "./validator"

function errorResult(message: string): FluxValidationResult {
  return {
    status: 2,
    findings: [],
    summary: { filesScanned: 0, total: 0, byRule: {}, note: message },
  }
}

export function createDashboardFluxValidatorTool(ctx: PluginInput): Record<string, ToolDefinition> {
  const dashboard_flux_validate: ToolDefinition = tool({
    description: DASHBOARD_FLUX_VALIDATE_DESCRIPTION,
    args: {
      path: tool.schema
        .string()
        .describe("Grafana provisioning YAML, dashboard JSON, or a directory (absolute, or project-relative)."),
    },
    async execute(args) {
      try {
        const base = ctx.directory
        const target = isAbsolute(args.path) ? args.path : join(base, args.path)
        if (!existsSync(target)) {
          return JSON.stringify(errorResult(`path not found: ${args.path}`), null, 2)
        }
        const result = validateDashboard({ base, target })
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return JSON.stringify(errorResult(`dashboard_flux_validate failed: ${message}`), null, 2)
      }
    },
  })

  return { dashboard_flux_validate }
}
