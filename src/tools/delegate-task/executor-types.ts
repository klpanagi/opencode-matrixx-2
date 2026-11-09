import type { AgentOverrides, BrowserAutomationProvider, CategoriesConfig, ComplexityDowngrades, ModelPresets, ModelRequirements } from "../../config/schema"
import type { EffortConfig } from "../../config/schema/effort"
import type { BackgroundManager } from "../../features/background-agent"
import type { NativeClient } from "./types"

export interface ExecutorContext {
  manager: BackgroundManager
  client: NativeClient
  /** Override for the active-child delegation signal used by the unstable poll guard. */
  getActiveChildSessionIDs?: (sessionID: string) => string[]
  directory: string
  userCategories?: CategoriesConfig
  mouseModel?: string
  globalModel?: string
  browserProvider?: BrowserAutomationProvider
  agentOverrides?: AgentOverrides
  modelRequirements?: ModelRequirements
  complexityDowngrades?: ComplexityDowngrades
  /** Named model presets from plugin config (`model_presets`). */
  modelPresets?: ModelPresets
  /** Active preset name from plugin config (`active_preset`). */
  activePreset?: string
  /** Invoking (parent) session ID — its preset overlay propagates to delegated tasks. */
  sessionID?: string
  onSyncSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
  /** Per-session effort accounting config; undefined disables foreground effort recording. */
  effortConfig?: EffortConfig
  /** Depth of the invoking session: 0 top-level, 1 delegated child. */
  depth?: number
  /** Tools a delegated child may use; single source for child tool maps. */
  allowedChildTools?: readonly string[]
}

export interface ParentContext {
  sessionID: string
  messageID: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
}

export type { ContentPart, SessionMessage } from "../../shared/session/session-message"
