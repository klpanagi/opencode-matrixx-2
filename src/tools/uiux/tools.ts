// The uiux skill-pack tools over the installed `ui-ux-pro-max` pack.
//
// Each tool only translates arguments into the upstream `search.py` argv and
// result data into a tool result; process execution, capping and error
// normalisation live in `runPackScript`.
import { join, resolve } from "node:path"
import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"
import {
  UIUX_DEFAULT_MAX_RESULTS,
  UIUX_DOMAINS,
  UIUX_STACKS,
} from "./constants"
import { formatToolError, runPackScript } from "./spawn"
import type { UiuxDomain, UiuxStack, UiuxToolDeps, UiuxToolError } from "./types"
import { runUiuxValidate } from "./validate"

/** Arguments accepted by `runUiuxSearch`. */
export interface UiuxSearchArgs {
  query: string
  domain?: UiuxDomain
  stack?: UiuxStack
  maxResults?: number
  full?: boolean
  json?: boolean
}

/** Successful search run: the capped stdout plus its truncation flag. */
export interface UiuxSearchSuccess {
  ok: true
  output: string
  truncated: boolean
}

/** Result of one `uiux_search` run — never thrown, always returned. */
export type UiuxSearchResult = UiuxSearchSuccess | UiuxToolError

/** Formats accepted by `search.py --design-system --format`. */
const UIUX_DESIGN_FORMATS = ["ascii", "markdown"] as const

/** Arguments accepted by `runUiuxDesignSystem`. */
export interface UiuxDesignSystemArgs {
  project: string
  format?: (typeof UIUX_DESIGN_FORMATS)[number]
  persist?: boolean
  /** Absolute directory the `design-system/` folder is created under. */
  outputDir?: string
  page?: string
  force?: boolean
}

/** Successful design-system run: the script output plus created files. */
export interface UiuxDesignSystemSuccess {
  ok: true
  output: string
  /** Absolute paths reported by the script, when persistence created files. */
  persisted?: string[]
}

/** Result of one `uiux_design_system` run — never thrown, always returned. */
export type UiuxDesignSystemResult = UiuxDesignSystemSuccess | UiuxToolError

const UIUX_SEARCH_DESCRIPTION = [
  "Search the installed ui-ux-pro-max knowledge base and return ranked guidance.",
  "Ask one dominant intent per query (for example \"dashboard onboarding\") instead of combining unrelated topics.",
  `Domains: ${UIUX_DOMAINS.join(", ")}. Stacks: ${UIUX_STACKS.join(", ")}.`,
  "maxResults limits text results (1-20, default 3); set json for the raw payload and full to stop truncating long fields.",
].join(" ")

const UIUX_DESIGN_SYSTEM_DESCRIPTION = [
  "Generate a complete design system for one project and return the rendered output.",
  "Persists design-system/<project>/MASTER.md under the project root by default; page adds an override file under pages/.",
  "force overwrites an existing MASTER.md; set persist false to preview without writing files.",
].join(" ")

const UIUX_VALIDATE_DESCRIPTION = [
  "Verify the installed ui-ux-pro-max skill pack without modifying it.",
  "Checks that lock.json parses, its file list matches the disk, runs the upstream data validator (scripts/validate_data.py) when present, and reports Python availability.",
].join(" ")

const uiuxSearchArgs = {
  query: z
    .string()
    .min(1)
    .describe("Search query; keep one dominant intent per call"),
  domain: z
    .enum(UIUX_DOMAINS)
    .optional()
    .describe("Knowledge domain to search (default: match across domains)"),
  stack: z
    .enum(UIUX_STACKS)
    .optional()
    .describe("Target framework stack for stack-specific guidance"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(UIUX_DEFAULT_MAX_RESULTS)
    .describe("Maximum text results to return (1-20)"),
  full: z
    .boolean()
    .optional()
    .describe("Do not truncate long field values in text output"),
  json: z.boolean().optional().describe("Return the raw JSON payload instead of text"),
}

const uiuxDesignSystemArgs = {
  project: z
    .string()
    .min(1)
    .describe("Project name; used as the generation query and folder slug"),
  format: z
    .enum(UIUX_DESIGN_FORMATS)
    .default("markdown")
    .describe("Rendered output format (default: markdown)"),
  persist: z
    .boolean()
    .default(true)
    .describe("Write design-system/<project>/MASTER.md (default: true)"),
  outputDir: z
    .string()
    .min(1)
    .optional()
    .describe("Project root to persist under (default: the session directory)"),
  page: z
    .string()
    .min(1)
    .optional()
    .describe("Also create a page override file under pages/"),
  force: z
    .boolean()
    .optional()
    .describe("Overwrite an existing MASTER.md instead of leaving it untouched"),
}

/** Builds the `search.py` argv in the documented long-flag order. */
function buildSearchArgs(args: UiuxSearchArgs): string[] {
  const argv = [args.query]
  if (args.domain !== undefined) argv.push("--domain", args.domain)
  if (args.stack !== undefined) argv.push("--stack", args.stack)
  argv.push("--max-results", String(args.maxResults ?? UIUX_DEFAULT_MAX_RESULTS))
  if (args.full === true) argv.push("--full")
  if (args.json === true) argv.push("--json")
  return argv
}

/**
 * Builds the design-system argv. `--page` and `--force` only apply when the
 * script persists, so they are omitted whenever persistence is off.
 */
function buildDesignSystemArgs(args: UiuxDesignSystemArgs): string[] {
  const argv = [
    args.project,
    "--design-system",
    "--project-name",
    args.project,
    "--format",
    args.format ?? "markdown",
  ]
  if (args.persist !== false) {
    argv.push("--persist")
    if (args.outputDir !== undefined) argv.push("--output-dir", args.outputDir)
    if (args.page !== undefined) argv.push("--page", args.page)
    if (args.force === true) argv.push("--force")
  }
  return argv
}

/** Mirrors the upstream `safe_slug` so derived paths match written folders. */
function slugifyProject(project: string): string {
  const slug = project
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "default"
}

/** Pulls the `📄 <path>` lines out of the persistence report. */
function reportedFiles(stdout: string): string[] {
  const files: string[] = []
  for (const line of stdout.split("\n")) {
    const match = /^\s*📄\s+(.+?)\s*$/u.exec(line)
    if (match?.[1] !== undefined) files.push(match[1])
  }
  return files
}

/**
 * Files this run created. The script's own report wins; when it confirms
 * persistence without listing files, MASTER.md is derived from the output dir.
 */
function persistedFiles(stdout: string, args: UiuxDesignSystemArgs): string[] {
  const reported = reportedFiles(stdout)
  if (reported.length > 0) return reported
  if (args.outputDir === undefined) return []
  if (!stdout.includes("Design system persisted to")) return []
  return [join(args.outputDir, "design-system", slugifyProject(args.project), "MASTER.md")]
}

/**
 * Runs the pack search script. Never throws; failures are returned as the
 * shared `UiuxToolError` shape. Truncated JSON is rejected outright so callers
 * never attempt to parse a partial payload.
 */
export async function runUiuxSearch(
  deps: UiuxToolDeps,
  args: UiuxSearchArgs,
): Promise<UiuxSearchResult> {
  const result = await runPackScript(deps, {
    script: join(deps.coreSkillRoot, "scripts", "search.py"),
    args: buildSearchArgs(args),
  })
  if (!result.ok) return result

  if (args.json === true && result.truncated) {
    return formatToolError(
      "truncated",
      "search.py JSON output was truncated; narrow the query or use text output",
    )
  }

  return { ok: true, output: result.stdout, truncated: result.truncated }
}

/**
 * Runs `search.py --design-system`. Never throws; non-zero exits surface as
 * the shared `UiuxToolError` shape. Callers must pass `outputDir` as an
 * absolute path — relative paths are resolved by the tool against the session
 * directory before this function runs.
 */
export async function runUiuxDesignSystem(
  deps: UiuxToolDeps,
  args: UiuxDesignSystemArgs,
): Promise<UiuxDesignSystemResult> {
  const result = await runPackScript(deps, {
    script: join(deps.coreSkillRoot, "scripts", "search.py"),
    args: buildDesignSystemArgs(args),
  })
  if (!result.ok) return result

  const persisted = args.persist === false ? [] : persistedFiles(result.stdout, args)
  return persisted.length > 0
    ? { ok: true, output: result.stdout, persisted }
    : { ok: true, output: result.stdout }
}

/**
 * Builds the uiux skill-pack tools. Registration lives in the plugin tool
 * catalog; this factory only owns the pack-facing tool definitions.
 */
export function createUiuxTools(deps: UiuxToolDeps): Record<string, MatrixxToolDefinition> {
  const uiux_search: MatrixxToolDefinition = defineTool("uiux_search", {
    description: UIUX_SEARCH_DESCRIPTION,
    args: uiuxSearchArgs,
    execute: async (args) => {
      const result = await runUiuxSearch(deps, args)
      if (!result.ok) {
        return {
          output: JSON.stringify(result),
          metadata: { ok: false, error: result.error },
        }
      }
      return {
        output: result.output,
        metadata: { ok: true, truncated: result.truncated },
      }
    },
  })

  const uiux_design_system: MatrixxToolDefinition = defineTool("uiux_design_system", {
    description: UIUX_DESIGN_SYSTEM_DESCRIPTION,
    args: uiuxDesignSystemArgs,
    execute: async (args, ctx) => {
      const outputDir = resolve(ctx.directory, args.outputDir ?? ".")
      const result = await runUiuxDesignSystem(deps, { ...args, outputDir })
      if (!result.ok) {
        return {
          output: JSON.stringify(result),
          metadata: { ok: false, error: result.error },
        }
      }
      return {
        output: result.output,
        metadata:
          result.persisted === undefined
            ? { ok: true }
            : { ok: true, persisted: result.persisted },
      }
    },
  })

  const uiux_validate: MatrixxToolDefinition = defineTool("uiux_validate", {
    description: UIUX_VALIDATE_DESCRIPTION,
    args: {},
    execute: async () => {
      const result = await runUiuxValidate(deps)
      if (result.ok) {
        return {
          output: JSON.stringify(result),
          metadata: { ok: true },
        }
      }
      if ("error" in result) {
        return {
          output: JSON.stringify(result),
          metadata: { ok: false, error: result.error },
        }
      }
      return {
        output: JSON.stringify(result),
        metadata: {
          ok: false,
          failed: result.checks.filter((check) => !check.ok).map((check) => check.name),
        },
      }
    },
  })

  return { uiux_search, uiux_design_system, uiux_validate }
}

export type {
  UiuxPythonProbe,
  UiuxValidateCheck,
  UiuxValidateCheckName,
  UiuxValidateOptions,
  UiuxValidateReport,
  UiuxValidateResult,
} from "./validate"
export { runUiuxValidate } from "./validate"