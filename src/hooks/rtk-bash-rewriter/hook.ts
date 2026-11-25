import type { MatrixxConfig } from "../../config"
import type { MatrixxContext } from "../../plugin/tool/context"
import { log } from "../../shared"
import { isShellTool } from "../../shared/io/shell-tool-name"
import { RTK_BINARY_NAME, RTK_REWRITE_COMMAND } from "./constants"

/**
 * Cached capability of the `rtk` binary, resolved once per hook instance.
 *
 * - `rewrite`: the binary advertises a `rewrite` subcommand (the registry exists).
 * - `passthrough`: the binary works but exposes no rewrite command, so no
 *   command can be rewritten. Matches the exit-code policy — a spawn could only
 *   reproduce the non-0/3 passthrough below.
 * - `unknown`: the probe was inconclusive; keep the pre-T6 always-spawn path.
 */
export type RtkRewriteCapability = "rewrite" | "passthrough" | "unknown"

/** One `rtk rewrite` subprocess, structurally compatible with a piped `Bun.spawn`. */
export interface RtkRewriteProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

/** Injection seams (tests/bench only; production call sites use the defaults). */
export interface RtkBashRewriterDeps {
  /** Binary lookup; defaults to `Bun.which`. */
  readonly which?: (binary: string) => string | null
  /** Rewrite subprocess factory; defaults to `Bun.spawn`. */
  readonly spawn?: (cmd: string[]) => RtkRewriteProcess
  /** One-time capability probe; defaults to inspecting `rtk --help`. */
  readonly probe?: (binary: string) => RtkRewriteCapability
}

/**
 * Command heads rtk's own classifier ignores outright, so `rtk rewrite` never
 * returns a rewrite for them (rtk 0.43.x `IGNORED_EXACT` / `IGNORED_PREFIXES`).
 * Only consulted for simple commands; see `isSimpleCommand`.
 */
const RTK_PASSTHROUGH_COMMANDS: ReadonlySet<string> = new Set([
  "awk",
  "bash",
  "case",
  "cd",
  "chmod",
  "chown",
  "cp",
  "cut",
  "echo",
  "export",
  "false",
  "for",
  "if",
  "kill",
  "mkdir",
  "mv",
  "printf",
  "pwd",
  "rm",
  "rtk",
  "sed",
  "set",
  "sh",
  "sleep",
  "sort",
  "source",
  "test",
  "touch",
  "tr",
  "true",
  "type",
  "uniq",
  "unset",
  "wait",
  "which",
  "while",
])

/** A lowercase `rewrite` entry with a description in `rtk --help`'s command list. */
const REWRITE_COMMAND_PATTERN = /\n\s+rewrite\s+\S/

/** Marks rtk's clap-shaped help page, so absence of `rewrite` is a real signal. */
const HELP_COMMANDS_HEADER = /^Commands:\s*$/m

/**
 * Shell syntax that can introduce another command, substitute a command, or
 * change tokenization. Any match keeps the command on the spawn path so an
 * eligible segment can never be missed.
 */
const SHELL_CONSTRUCT_PATTERN = /[|&;<>()$`\\"'*?[\]{}~!#=\n\r\t]/

const WHITESPACE = /\s+/

function defaultWhich(binary: string): string | null {
  return Bun.which(binary)
}

function defaultSpawn(cmd: string[]): RtkRewriteProcess {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  return { exited: proc.exited, stdout: proc.stdout }
}

function defaultProbe(binary: string): RtkRewriteCapability {
  try {
    // Bound the one-time probe so a wedged binary cannot stall plugin init.
    const result = Bun.spawnSync([binary, "--help"], { stdout: "pipe", stderr: "pipe", timeout: 1000 })
    if (result.exitCode !== 0) return "unknown"
    const help = result.stdout.toString()
    // Only trust a help page shaped like rtk's clap output before concluding absence.
    if (!HELP_COMMANDS_HEADER.test(help)) return "unknown"
    return REWRITE_COMMAND_PATTERN.test(help) ? "rewrite" : "passthrough"
  } catch {
    return "unknown"
  }
}

/** First whitespace-separated token; empty when the command is blank. */
function commandHead(command: string): string {
  return command.trim().split(WHITESPACE, 1)[0] ?? ""
}

/**
 * True only for a single plain command (`rm -rf node_modules`) with no shell
 * operators, substitutions, quotes, redirects, env assignments, or path-prefixed
 * head. Anything else may embed an eligible segment, so it stays on the spawn path.
 */
function isSimpleCommand(command: string): boolean {
  if (SHELL_CONSTRUCT_PATTERN.test(command)) return false
  const head = commandHead(command)
  return head !== "" && !head.includes("/")
}

/** True when rtk's registry provably never rewrites this simple command. */
function isPassthroughOnly(command: string): boolean {
  return isSimpleCommand(command) && RTK_PASSTHROUGH_COMMANDS.has(commandHead(command))
}

export function createRtkBashRewriterHook(
  _ctx: MatrixxContext,
  config: MatrixxConfig,
  deps: RtkBashRewriterDeps = {},
) {
  const rtkConfig = config.rtk
  const binaryPath = rtkConfig?.binary_path ?? RTK_BINARY_NAME
  const which = deps.which ?? defaultWhich
  const spawn = deps.spawn ?? defaultSpawn
  const probe = deps.probe ?? defaultProbe

  // Check for rtk binary at creation time (not per-call)
  const hasRtk = which(binaryPath) !== null
  // Cache the rewrite capability once per hook instance; never re-probe per call.
  const capability: RtkRewriteCapability = hasRtk ? probe(binaryPath) : "unknown"

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

      // The binary exposes no rewrite registry, so a spawn cannot produce a rewrite.
      if (capability === "passthrough") {
        return
      }

      // Skip the subprocess for command classes rtk never rewrites. An unknown
      // capability keeps the legacy always-spawn path.
      if (capability === "rewrite" && isPassthroughOnly(command)) {
        return
      }

      try {
        const proc = spawn([binaryPath, RTK_REWRITE_COMMAND, command])

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
          log("[rtk-bash-rewriter] Command rewritten", { changed: true, length: command.length })
        }
      } catch (error) {
        // Silent passthrough on any error
        log(`[rtk-bash-rewriter] Rewrite failed: ${error}`)
      }
    },
  }
}
