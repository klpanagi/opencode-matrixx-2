import { existsSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import picomatch from "picomatch"
import { log } from "../../shared"
import { scanPath } from "../../tools/silent-failure-scanner"
import { getRuleInjectionFilePath } from "../rules-injector/output-path"
import {
  FINANCE_PATH_GLOBS,
  SILENT_FAILURE_GUARD_MAX_CONTENT_BYTES,
  SILENT_FAILURE_GUARD_MAX_FINDINGS,
  SILENT_FAILURE_GUARD_TOOLS,
} from "./constants"

interface ToolExecuteAfterInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: unknown
}

function isFinancePath(filePath: string): boolean {
  return picomatch.isMatch(filePath, FINANCE_PATH_GLOBS, { dot: true, bash: true })
}

function buildWarning(
  findings: Array<{ rule: string; severity: string; file: string; line: number; excerpt: string; why: string; fix: string }>,
  total: number,
): string {
  const lines = findings.map(
    (finding) =>
      `- ${finding.rule} (${finding.severity}) ${finding.file}:${finding.line}\n    ${finding.excerpt}\n    why: ${finding.why}\n    fix: ${finding.fix}`,
  )
  const overflow = total > findings.length ? `\n(+${total - findings.length} more not shown)` : ""
  return [
    "[silent-failure-guard] Detected silent-failure anti-patterns in finance code (warning only — the write was not blocked):",
    ...lines,
    overflow,
  ]
    .filter((line) => line.length > 0)
    .join("\n")
}

/**
 * Warn-first, non-blocking silent-failure guard.
 *
 * Runs on `tool.execute.after` and only for `edit`/`write` completions whose
 * target is a `*.py` file matching a finance-path glob. It reuses the scanner
 * rule engine (`scanPath`) on the changed file and appends a warning to the
 * tool output. It never blocks and never swallows its own errors — a failure in
 * the guard is logged explicitly so the guard is not itself a silent failure.
 */
export function createSilentFailureGuardHook(ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      try {
        if (!output) return

        const tool = input.tool?.toLowerCase()
        if (!SILENT_FAILURE_GUARD_TOOLS.includes(tool)) return

        const filePath = getRuleInjectionFilePath({ title: output.title, metadata: output.metadata })
        if (!filePath) return
        if (!/\.py$/i.test(filePath)) return

        const resolvedPath = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
        if (!isFinancePath(resolvedPath)) return
        if (!existsSync(resolvedPath)) return

        const size = statSync(resolvedPath).size
        if (size > SILENT_FAILURE_GUARD_MAX_CONTENT_BYTES) {
          log("[silent-failure-guard] Skipping oversized file", { sessionID: input.sessionID, resolvedPath, size })
          return
        }

        const result = scanPath({ base: ctx.directory, target: resolvedPath })
        if (result.findings.length === 0) return

        const surfaced = result.findings.slice(0, SILENT_FAILURE_GUARD_MAX_FINDINGS)
        output.output += `\n\n${buildWarning(surfaced, result.findings.length)}`

        log("[silent-failure-guard] Surfaced silent-failure findings", {
          sessionID: input.sessionID,
          resolvedPath,
          total: result.findings.length,
          surfaced: surfaced.length,
        })
      } catch (error) {
        // Explicit: if the guard itself fails, that must be observable.
        log("[silent-failure-guard] Guard failed while scanning", {
          sessionID: input.sessionID,
          tool: input.tool,
          error,
        })
      }
    },
  }
}
