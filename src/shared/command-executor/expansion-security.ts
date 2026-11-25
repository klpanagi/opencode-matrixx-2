import type { CommandExpansionConfig, FileReferenceConfig } from "../../config/schema/security"
import { type CommandExpansionPolicy, isTrustedScope } from "./types"

/** Security slice threaded from pluginConfig.security. */
export interface CommandExpansionSecurity {
  command_expansion?: CommandExpansionConfig
  file_reference?: FileReferenceConfig
}

export interface ExpansionSecurityDecision {
  policy: CommandExpansionPolicy
  allowFileRefs: boolean
}

/**
 * Shared trust decision for both expansion call sites: trusted scopes keep
 * legacy behaviour; repo-controlled scopes are denied unless the security
 * slice opts the command in. Do not duplicate this logic at call sites.
 */
export function buildExpansionSecurity(
  scope: string,
  commandName: string,
  security?: CommandExpansionSecurity,
): ExpansionSecurityDecision {
  const commandExpansion = security?.command_expansion
  const allowlist = commandExpansion?.allowlist ?? []
  return {
    policy: {
      allowShell: commandExpansion?.project_scope_execution === true,
      allowlist,
      commandName,
      scope,
    },
    allowFileRefs:
      isTrustedScope(scope) ||
      (commandExpansion?.project_scope_file_refs === true && allowlist.includes(commandName)),
  }
}
