/** builtin-commands barrel: explicit named re-exports of local modules only. */
export {
  BUILTIN_COMMAND_DEFINITIONS,
} from "./commands"
export {
  buildBuiltinCommandEntries,
  type CommandAgentDeps,
  type CommandDefinitionInput,
  type CommandInvocation,
  type CommandSessionDeps,
  type CommandTransformDomain,
  type CommandTransformEditor,
  evaluateCommandTemplate,
  type RegisterCommandTransformDeps,
  type RegisterCommandTransformResult,
  registerCommandTransform,
} from "./commands.transform"
export type {
  BuiltinCommandName,
  BuiltinCommands,
} from "./types"
