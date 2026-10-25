/**
 * V2-native command domain transform (D4).
 *
 * Owned by `src/features/builtin-commands/`: pure entry builder +
 * single `ctx.command.transform` registration. No filesystem access, no spawn,
 * no network — the definitions record in `./commands` is static data, so
 * repeated runs over the same disabled set replay identically.
 */

import type { CommandDefinition } from "../command-loader"
import { BUILTIN_COMMAND_DEFINITIONS } from "./commands"
import type { BuiltinCommandName, BuiltinCommands } from "./types"

/** Pure: builtin command entries for a given disabled set. */
export function buildBuiltinCommandEntries(
  disabledCommands?: BuiltinCommandName[],
): BuiltinCommands {
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(BUILTIN_COMMAND_DEFINITIONS)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}

/** Minimal structural editor: the real V2 command editor satisfies this. */
export interface CommandTransformEditor {
  add(entry: unknown): void
}

export interface CommandTransformDomain {
  transform(callback: (editor: CommandTransformEditor) => void): Promise<unknown>
}

export interface RegisterCommandTransformResult {
  registration: unknown
  /** Command names replayed onto the domain. */
  registered: string[]
}

/**
 * Pure replay: command entries → `ctx.command.transform`.
 * The only effect is the single `transform` call; the callback only calls
 * `editor.add`, so re-running over the same entries replays identically.
 */
export async function registerCommandTransform(
  command: CommandTransformDomain,
  entries: Record<string, unknown> | undefined,
): Promise<RegisterCommandTransformResult> {
  const registered: string[] = []
  const registration = await command.transform((editor) => {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      const record =
        entry !== null && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {}
      editor.add({ ...record, name: typeof record.name === "string" ? record.name : name })
      registered.push(name)
    }
  })
  return { registration, registered }
}
