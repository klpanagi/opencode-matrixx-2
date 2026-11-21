import { resolve } from "node:path"
import { z } from "zod"
import type { MatrixxContext } from "../../plugin/tool/context"
import { formatReport, scanPaths } from "../../shared/comment-scan"
import { AGENT_MEMO_PREFIXES } from "../../shared/comment-scan/allow-list"
import type { CommentFinding, ScanResult, ScanTier } from "../../shared/comment-scan/types"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"

const COMMENT_SCAN_DESCRIPTION =
  "Report comments and docstrings that look like AI-added noise or restate the code they sit next to. " +
  'Covers both tiers: AST comments/docstrings for tree-sitter languages, and a "regex" tier for ' +
  "languages without tree-sitter support. Findings are advisory, not errors: judge each one and keep " +
  "only necessary comments or docstrings. Use this tool instead of $COMMENT ast-grep patterns, which " +
  "silently match nothing."

const PATHS_DESCRIPTION =
  "Files or directories to scan; relative paths resolve against the context directory, absolute paths are used as given."

const TIER_DESCRIPTION =
  'Scan tier: "ast" for tree-sitter languages, "regex" for the heuristic fallback, "both" for both.'

function skippedLine(skipped: NonNullable<ScanResult["skipped"]>): string {
  if (skipped === "binary-missing") {
    return 'Scan skipped: binary-missing (ast-grep "sg" binary not found).'
  }
  if (skipped === "unsupported") {
    return "Scan skipped: unsupported (no supported scan language in the given paths)."
  }
  return "Scan skipped: timeout."
}

function errorBlock(errors: readonly string[]): string {
  return `Errors:\n${errors.map((error) => `- ${error}`).join("\n")}`
}

function renderFindings(
  findings: readonly CommentFinding[],
  filePath: string,
  tier: ScanTier,
): string {
  return formatReport({
    findings,
    filePath,
    tier,
    includeRubric: false,
    agentMemoPrefixes: AGENT_MEMO_PREFIXES,
  })
}

export function createCommentScanTool(ctx: MatrixxContext): Record<string, MatrixxToolDefinition> {
  const comment_scan: MatrixxToolDefinition = defineTool("comment_scan", {
    description: COMMENT_SCAN_DESCRIPTION,
    args: {
      paths: z.array(z.string()).min(1).describe(PATHS_DESCRIPTION),
      tier: z.enum(["ast", "regex", "both"]).optional().default("both").describe(TIER_DESCRIPTION),
    },
    execute: async (args) => {
      const tier = args.tier ?? "both"
      const paths = args.paths.map((path) => resolve(ctx.directory, path))
      try {
        const result = await scanPaths(paths, { tier })
        const lines: string[] = []

        if (result.errors && result.errors.length > 0) lines.push(errorBlock(result.errors))
        if (result.findings.length > 0) {
          const filePath = args.paths.join(", ")
          const astFindings = result.findings.filter((finding) => finding.tier === "ast")
          const regexFindings = result.findings.filter((finding) => finding.tier === "regex")
          if (astFindings.length > 0) lines.push(renderFindings(astFindings, filePath, "ast"))
          if (regexFindings.length > 0) lines.push(renderFindings(regexFindings, filePath, "regex"))
        } else if (!result.errors || result.errors.length === 0) {
          lines.push("No comment findings.")
        }

        if (result.skipped) lines.push(skippedLine(result.skipped))
        return lines.join("\n")
      } catch (error) {
        return `ERROR: comment_scan failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })

  return { comment_scan }
}
