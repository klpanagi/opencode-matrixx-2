/**
 * The agent definition matrixx builds and registers with OpenCode.
 *
 * OpenCode 2.x describes an agent as `Agent.Info` (packages/schema/src/agent.ts):
 * the system prompt is `system`, permissions are a ruleset of
 * `{action, resource, effect}`, sampling and provider parameters live under
 * `request`, and the model is a reference rather than a "provider/model" string.
 * Building that shape here keeps the translation out of the registration path.
 */

import type { PermissionRule } from "../shared/permission-compat"

export type { PermissionEffect, PermissionRule } from "../shared/permission-compat"
export { rule } from "../shared/permission-compat"

/**
 * Agent mode determines UI model selection behavior:
 * - "primary": Respects user's UI-selected model (morpheus, architect)
 * - "subagent": Uses own fallback chain, ignores UI selection (merovingian, trinity, etc.)
 * - "all": Available in both contexts (OpenCode compatibility)
 */
export type AgentMode = "primary" | "subagent" | "all"

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

export interface ProviderRequest {
  settings?: Record<string, unknown>
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export interface AgentConfig {
  model?: ModelRef
  request?: ProviderRequest
  system?: string
  description?: string
  mode?: AgentMode
  hidden?: boolean
  color?: string
  steps?: number
  disabled?: boolean
  permissions?: PermissionRule[]
}

/**
 * `"provider/model#variant"` is the only form OpenCode treats as a variant
 * selector; a "#" anywhere else belongs to the model id and is left alone.
 */
export function parseModelRef(selection: string | undefined): ModelRef | undefined {
  if (!selection) return undefined
  const hash = selection.indexOf("#")
  const selectionWithoutVariant = hash === -1 ? selection : selection.slice(0, hash)
  const slash = selectionWithoutVariant.indexOf("/")
  if (slash <= 0 || slash === selectionWithoutVariant.length - 1) return undefined
  const variant = hash === -1 ? undefined : selection.slice(hash + 1)
  return {
    providerID: selectionWithoutVariant.slice(0, slash),
    id: selectionWithoutVariant.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}
