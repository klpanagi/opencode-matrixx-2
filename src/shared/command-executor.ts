export { CommandNotAllowedError, createExecuteCommand, type ExecuteCommandOptions, executeCommand } from "./command-executor/execute-command"
export { buildExpansionSecurity, type CommandExpansionSecurity, type ExpansionSecurityDecision } from "./command-executor/expansion-security"
export { type ResolveCommandsOptions, resolveCommandsInText } from "./command-executor/resolve-commands-in-text"
export { BLOCKED_SHELL_EXPANSION_MARKER, type CommandExpansionPolicy, type CommandScope, decideExpansion, type ExpansionDecision, isTrustedScope } from "./command-executor/types"
