import { z } from "zod"
import type { BackgroundManager } from "../../features/background-agent"
import { listKnownSessions } from "../../features/background-agent/manager"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { isLaunchTerminalStatus } from "../../shared/saturated-outcome"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import { BACKGROUND_WAIT_ALL_DESCRIPTION } from "./constants"
import type { ToolContextWithMetadata } from "./types"


export function createBackgroundWaitAll(manager: BackgroundManager): MatrixxToolDefinition {
  return defineTool("background_wait_all", {
    description: BACKGROUND_WAIT_ALL_DESCRIPTION,
    args: {
      timeout: z
        .number()
        .optional()
        .describe("Max wait time in ms (default: 30000, max: 120000)"),
    },
    async execute(args: { timeout?: number }, toolContext) {
      try {
        const ctx = toolContext as ToolContextWithMetadata
        const timeoutMs = Math.min(args.timeout ?? 30000, 120000)

        const callID = resolveToolCallID(ctx as ToolContextWithMetadata & { callID?: string; callId?: string; call_id?: string })
        if (callID) {
          storeToolMetadata(ctx.sessionID, callID, {
            title: "Wait for all background tasks",
            metadata: { timeoutMs } as Record<string, unknown>,
          })
        }

        let coverage: { bgPending: string[]; liveSes: string[] } = { bgPending: [], liveSes: [] }
        try {
          coverage = listKnownSessions(manager)
        } catch {
          coverage = { bgPending: [], liveSes: [] }
        }

        const result = await manager.waitForAllDescendants(ctx.sessionID, timeoutMs)

        if (result.completed.length === 0 && result.timedOut.length === 0) {
          return "No background tasks were running or pending. Nothing to wait for."
        }

        type WaitRow = { id: string; description: string; agent: string; status: string }
        const rowOf = (t: WaitRow): string => `| \`${t.id}\` | ${t.description} | ${t.agent} | ${t.status} |`
        const succeeded = result.completed.filter((t) => t.status === "completed")
        const terminalFailures = result.completed.filter(
          (t) => t.status !== "completed" && isLaunchTerminalStatus(t.status),
        )

        const lines: string[] = []
        if (succeeded.length > 0) {
          lines.push(`## Completed (${succeeded.length})`)
          lines.push("| Task ID | Description | Agent | Status |")
          lines.push("|---------|-------------|-------|--------|")
          for (const t of succeeded) {
            lines.push(rowOf(t))
          }
        }

        if (terminalFailures.length > 0) {
          lines.push(`\n## Terminal failures (${terminalFailures.length})`)
          lines.push("These tasks settled without success; inspect each with `background_output(task_id=\"...\")`.")
          lines.push("| Task ID | Description | Agent | Status |")
          lines.push("|---------|-------------|-------|--------|")
          for (const t of terminalFailures) {
            lines.push(rowOf(t))
          }
        }

        if (result.timedOut.length > 0) {
          lines.push(`\n## Timed Out (${result.timedOut.length})`)
          lines.push("These tasks did not finish within the timeout and are still running.")
          lines.push("| Task ID | Description | Agent | Status |")
          lines.push("|---------|-------------|-------|--------|")
          for (const t of result.timedOut) {
            lines.push(rowOf(t))
          }
          if (coverage.liveSes.length > 0) {
            lines.push(`\n> Coverage: ${coverage.bgPending.length} bg_ pending plus ${coverage.liveSes.length} known live ses_* sessions polled in one bounded loop (no per-ID fan-out; concurrency stays within the ~10 cap).`)
          }
          lines.push(
            "\n> Use `background_output(task_id=\"...\")` to check individual results, or `background_cancel(all=true)` to clean up.",
          )
        }

        return lines.join("\n")
      } catch (error) {
        return `[ERROR] Error waiting for background tasks: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
