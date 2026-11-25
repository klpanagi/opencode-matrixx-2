
export type CommandScope = "builtin" | "opencode" | "user" | "skill" | "plugin" | "opencode-project" | "project"

export interface CommandExpansionPolicy {
  allowShell: boolean
  allowlist: readonly string[]
  commandName: string
  scope: string
}

export interface ExpansionDecision {
  allowShell: boolean
  reason?: string
}

export const BLOCKED_SHELL_EXPANSION_MARKER = "[blocked: shell expansion disabled for project-scope command]"

export const TRUSTED_SCOPES: readonly string[] = ["builtin", "opencode", "user", "skill", "plugin"]

export function isTrustedScope(scope: string): boolean {
  return TRUSTED_SCOPES.includes(scope)
}

const DENIAL_REASON = "shell expansion disabled for project-scope command"

// Pure; a missing policy preserves the legacy always-allow behaviour.
export function decideExpansion(policy?: CommandExpansionPolicy): ExpansionDecision {
  if (!policy) {
    return { allowShell: true }
  }
  if (isTrustedScope(policy.scope)) {
    return { allowShell: true }
  }
  if (policy.allowShell && policy.allowlist.includes(policy.commandName)) {
    return { allowShell: true }
  }
  return { allowShell: false, reason: DENIAL_REASON }
}
