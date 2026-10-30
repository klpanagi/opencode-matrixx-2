import type { MatrixxConfig, RuntimeFallbackConfig } from "../../config"
import type { V2Event } from "../../plugin/context"
import type { SessionDomainLike } from "../../shared/session-context-source"
export interface RuntimeFallbackInterval {
  unref: () => void
}

export type RuntimeFallbackTimeout = object | number

export interface RuntimeFallbackPluginInput {
  session: SessionDomainLike
  directory: string
}

export interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>
  attemptCount: number
  pendingFallbackModel?: string
}

export interface FallbackResult {
  success: boolean
  newModel?: string
  error?: string
  maxAttemptsReached?: boolean
}

export interface RuntimeFallbackOptions {
  config?: RuntimeFallbackConfig
  pluginConfig?: MatrixxConfig
  session_timeout_ms?: number
}

export interface RuntimeFallbackHook {
  event: (event: V2Event) => Promise<void>
  "chat.message"?: (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }
  ) => Promise<void>
  dispose?: () => void
}

export interface HookDeps {
  ctx: RuntimeFallbackPluginInput
  config: Required<RuntimeFallbackConfig>
  options: RuntimeFallbackOptions | undefined
  pluginConfig: MatrixxConfig | undefined
  sessionStates: Map<string, FallbackState>
  sessionLastAccess: Map<string, number>
  sessionRetryInFlight: Set<string>
  sessionAwaitingFallbackResult: Set<string>
  sessionFallbackTimeouts: Map<string, RuntimeFallbackTimeout>
  sessionStatusRetryKeys: Map<string, string>
}
