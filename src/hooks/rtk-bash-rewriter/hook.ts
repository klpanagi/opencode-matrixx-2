import type { MatrixxConfig } from "../../config"
import type { MatrixxContext } from "../../plugin/context"
import { log } from "../../shared"
import { isShellTool } from "../../shared/shell-tool-name"
import { RTK_BINARY_NAME, RTK_REWRITE_COMMAND } from "./constants"

export function createRtkBashRewriterHook(_ctx: MatrixxContext, config: MatrixxConfig) {
  const rtkConfig = config.rtk
  const binaryPath = rtkConfig?.binary_path ?? RTK_BINARY_NAME

  // Check for rtk binary at creation time (not per-call)
  const hasRtk = Bun.which(binaryPath) !== null
  if (!hasRtk) {
    log(`[rtk-bash-rewriter] rtk binary not found at '${binaryPath}'. Hook will pass through all commands.`)
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      // Only intercept the shell tool (bash V1 alias / shell V2 name; not interactive-bash)
      if (!isShellTool(input.tool)) {
        return
      }

      // If rtk not available, pass through silently
      if (!hasRtk) {
        return
      }

      const command = output.args.command as string | undefined
      if (!command) {
        return
      }

      try {
        const proc = Bun.spawn([binaryPath, RTK_REWRITE_COMMAND, command], {
          stdout: "pipe",
          stderr: "pipe",
        })

        // Wait for exit
        const exitCode = await proc.exited
        // Exit codes: 0=success, 1=no RTK equivalent, 2=deny, 3=rewrite available
        // We accept both 0 and 3 as successful rewrites
        if (exitCode !== 0 && exitCode !== 3) {
          // Exit codes 1/2 = passthrough (no blocking)
          return
        }

        const rewritten = await new Response(proc.stdout).text()
        const trimmed = rewritten.trim()

        // Only mutate if rewrite produced a different command
        if (trimmed && trimmed !== command) {
          output.args.command = trimmed
          log(`[rtk-bash-rewriter] Rewrote command: '${command}' → '${trimmed}'`)
        }
      } catch (error) {
        // Silent passthrough on any error
        log(`[rtk-bash-rewriter] Rewrite failed: ${error}`)
      }
    },
  }
}
