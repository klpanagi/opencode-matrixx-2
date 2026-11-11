import type { AgentOverrides } from "../../config"

export type ModelInfo = { providerID: string; modelID: string }

export interface NiobeHookOptions {
  directory: string
  isContinuationStopped?: (sessionID: string) => boolean
  agentOverrides?: AgentOverrides
  nowMonotonic?: () => number
}

export interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export interface SessionState {
  lastEventWasAbortError?: boolean
  lastContinuationInjectedAt?: number
  promptFailureCount: number
}
