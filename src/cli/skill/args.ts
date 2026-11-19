/**
 * Argument parsing for `matrixx skill <subcommand>`.
 *
 * Pure: every parser takes the raw argv that follows the `skill` command and
 * returns a strongly typed command or throws {@link SkillUsageError}. Nothing
 * here touches the filesystem, the network, or `process`.
 */

/** Usage error; callers map this onto exit code 2. */
export class SkillUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillUsageError"
  }
}

/** Sink pair threaded through the skill subcommands so tests can capture output. */
export interface SkillIO {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

export interface SkillAddCommand {
  command: "add"
  packs: string[]
  all: boolean
  version?: string
  force: boolean
  dryRun: boolean
  allowNetwork: boolean
  allowApiKeys: boolean
  root?: string
  json: boolean
}

export interface SkillListCommand {
  command: "list"
  root?: string
  json: boolean
}

export interface SkillRemoveCommand {
  command: "remove"
  pack: string
  version?: string
  force: boolean
  root?: string
}

export interface SkillHelpCommand {
  command: "help"
}

/** Parsed `matrixx skill` invocation. */
export type SkillCommand = SkillAddCommand | SkillListCommand | SkillRemoveCommand | SkillHelpCommand

export const SKILL_USAGE = `Usage:
  matrixx skill add [pack...] [--all] [--version X] [--force] [--dry-run]
                    [--allow-network] [--allow-api-keys] [--root DIR] [--json]
  matrixx skill list [--json] [--root DIR]
  matrixx skill remove <pack> [--version X] [--force] [--root DIR]`

function readValue(args: string[], flag: string, index: number): string {
  const value = args[index]
  if (value === undefined || value.startsWith("-")) {
    throw new SkillUsageError(`${flag} requires a value`)
  }
  return value
}

function parseAdd(args: string[]): SkillAddCommand {
  const command: SkillAddCommand = {
    command: "add",
    packs: [],
    all: false,
    force: false,
    dryRun: false,
    allowNetwork: false,
    allowApiKeys: false,
    json: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === "--all") {
      command.all = true
    } else if (arg === "--force") {
      command.force = true
    } else if (arg === "--dry-run") {
      command.dryRun = true
    } else if (arg === "--allow-network") {
      command.allowNetwork = true
    } else if (arg === "--allow-api-keys") {
      command.allowApiKeys = true
    } else if (arg === "--json") {
      command.json = true
    } else if (arg === "--version") {
      command.version = readValue(args, "--version", ++i)
    } else if (arg.startsWith("--version=")) {
      command.version = readValue([arg.slice("--version=".length)], "--version", 0)
    } else if (arg === "--root") {
      command.root = readValue(args, "--root", ++i)
    } else if (arg.startsWith("--root=")) {
      command.root = readValue([arg.slice("--root=".length)], "--root", 0)
    } else if (arg.startsWith("-")) {
      throw new SkillUsageError(`Unknown option for 'skill add': ${arg}`)
    } else {
      command.packs.push(arg)
    }
  }

  if (command.all && command.packs.length > 0) {
    throw new SkillUsageError("Use either --all or explicit pack names, not both")
  }
  if (!command.all && command.packs.length === 0) {
    throw new SkillUsageError("Specify at least one skill pack or pass --all")
  }

  return command
}

function parseList(args: string[]): SkillListCommand {
  const command: SkillListCommand = { command: "list", json: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === "--json") {
      command.json = true
    } else if (arg === "--root") {
      command.root = readValue(args, "--root", ++i)
    } else if (arg.startsWith("--root=")) {
      command.root = readValue([arg.slice("--root=".length)], "--root", 0)
    } else if (arg.startsWith("-")) {
      throw new SkillUsageError(`Unknown option for 'skill list': ${arg}`)
    } else {
      throw new SkillUsageError(`Unexpected argument for 'skill list': ${arg}`)
    }
  }

  return command
}

function parseRemove(args: string[]): SkillRemoveCommand {
  let pack: string | undefined
  let version: string | undefined
  let root: string | undefined
  let force = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === "--force") {
      force = true
    } else if (arg === "--version") {
      version = readValue(args, "--version", ++i)
    } else if (arg.startsWith("--version=")) {
      version = readValue([arg.slice("--version=".length)], "--version", 0)
    } else if (arg === "--root") {
      root = readValue(args, "--root", ++i)
    } else if (arg.startsWith("--root=")) {
      root = readValue([arg.slice("--root=".length)], "--root", 0)
    } else if (arg.startsWith("-")) {
      throw new SkillUsageError(`Unknown option for 'skill remove': ${arg}`)
    } else if (pack === undefined) {
      pack = arg
    } else {
      throw new SkillUsageError("'skill remove' accepts exactly one pack")
    }
  }

  if (pack === undefined) {
    throw new SkillUsageError("'skill remove' requires a pack name")
  }

  return { command: "remove", pack, version, force, root }
}

/**
 * Parses the argv that follows `matrixx skill`.
 *
 * @example parseSkillArgs(["add", "ui-styling", "--allow-network"])
 */
export function parseSkillArgs(argv: string[]): SkillCommand {
  if (argv.length === 0) {
    throw new SkillUsageError("Missing skill subcommand")
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" }
  }

  const [subcommand, ...rest] = argv
  switch (subcommand) {
    case "add":
      return parseAdd(rest)
    case "list":
      return parseList(rest)
    case "remove":
      return parseRemove(rest)
    default:
      throw new SkillUsageError(`Unknown skill subcommand: ${subcommand}`)
  }
}
