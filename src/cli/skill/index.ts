import type { installPack, listPacks, removePack } from "../skill-pack/installer"
import { runAdd } from "./add"
import {
  parseSkillArgs,
  SKILL_USAGE,
  type SkillCommand,
  type SkillIO,
  SkillUsageError,
} from "./args"
import { runList } from "./list"
import { runRemove } from "./remove"

/** Optional seams; tests inject the installer functions and capture sinks. */
export interface SkillCommandDeps {
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  install?: typeof installPack
  remove?: typeof removePack
  list?: typeof listPacks
}

function defaultIO(deps: SkillCommandDeps): SkillIO {
  return {
    stdout: deps.stdout ?? ((line) => console.log(line)),
    stderr: deps.stderr ?? ((line) => console.error(line)),
  }
}

/**
 * Dispatches `matrixx skill <subcommand>` and returns an exit code instead of
 * calling `process.exit`, so the caller owns process termination.
 *
 * Exit codes: 0 success, 1 runtime failure, 2 usage or unknown pack.
 */
export async function runSkillCommand(
  argv: string[],
  deps: SkillCommandDeps = {},
): Promise<number> {
  const io = defaultIO(deps)

  let command: SkillCommand
  try {
    command = parseSkillArgs(argv)
  } catch (err) {
    if (err instanceof SkillUsageError) {
      io.stderr(`Error: ${err.message}`)
      io.stderr("")
      io.stderr(SKILL_USAGE)
      return 2
    }
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  switch (command.command) {
    case "help":
      io.stdout(SKILL_USAGE)
      return 0
    case "add":
      return runAdd(command, io, deps.install)
    case "list":
      return runList(command, io, deps.list)
    case "remove":
      return runRemove(command, io, deps.remove)
  }
}

export type {
  SkillAddCommand,
  SkillCommand,
  SkillHelpCommand,
  SkillListCommand,
  SkillRemoveCommand,
} from "./args"
export { parseSkillArgs, SKILL_USAGE, SkillUsageError } from "./args"
