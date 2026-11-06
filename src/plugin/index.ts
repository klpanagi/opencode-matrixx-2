// Single composition root for the plugin domain.
// Explicit named re-exports of the handlers/tool/hooks/message-hooks public
// surface only — no logic, no side effects.

export {
  applyAgentConfig,
  getAvailableToolNames,
  injectContextDiscipline,
  setAvailableToolNames,
} from "./handlers/agent-config-handler"
export { reorderAgentsByPriority } from "./handlers/agent-priority-order"
export type { PilotToolAllowlistAgent } from "./handlers/agent-tool-allowlist"
export {
  applyAgentToolAllowlist,
  DEFAULT_TOOL_ALLOWLIST,
  PILOT_TOOL_ALLOWLIST_AGENTS,
} from "./handlers/agent-tool-allowlist"
export { resolveCategoryConfig } from "./handlers/category-config-resolver"
export { applyCommandConfig } from "./handlers/command-config-handler"
export type { ConfigHandlerDeps } from "./handlers/config-handler"
export { createConfigHandler } from "./handlers/config-handler"
export { applyFormatterConfig } from "./handlers/formatter-config-handler"
export { applyMcpConfig } from "./handlers/mcp-config-handler"
export { buildOracleAgentConfig } from "./handlers/oracle-agent-config-builder"
export { buildPlanDemoteConfig } from "./handlers/plan-model-inheritance"
export type { PluginComponents } from "./handlers/plugin-components-loader"
export { loadPluginComponents } from "./handlers/plugin-components-loader"
export { applyProviderConfig } from "./handlers/provider-config-handler"
export {
  deniesDelegation,
  denyTodoPermissions,
  deriveTaskPermissions,
  fullTaskPermissions,
  isTaskStorePrimary,
  taskStorePermissions,
} from "./handlers/task-permissions"
export { applyToolConfig } from "./handlers/tool-config-handler"
export type { ContinuationHooks } from "./hooks/create-continuation-hooks"
export { createContinuationHooks } from "./hooks/create-continuation-hooks"
export type { SessionHooks } from "./hooks/create-session-hooks"
export { createSessionHooks } from "./hooks/create-session-hooks"
export type { SkillHooks } from "./hooks/create-skill-hooks"
export { createSkillHooks } from "./hooks/create-skill-hooks"
export type { ToolGuardHooks } from "./hooks/create-tool-guard-hooks"
export { createToolGuardHooks } from "./hooks/create-tool-guard-hooks"
export type { TransformHooks } from "./hooks/create-transform-hooks"
export { createTransformHooks } from "./hooks/create-transform-hooks"
export type { MessageHookDeps, MessageHookName, MessageHookRow, SessionMessage } from "./message-hooks"
export {
  MESSAGE_HOOK_TABLE,
  registerMessageHooks,
  validateMessageHookTable,
} from "./message-hooks"
export { createAvailableCategories } from "./tool/available-categories"
export { createChatMessageHandler } from "./tool/chat-message"
export { createChatParamsHandler } from "./tool/chat-params"
export type {
  Cleanup,
  MatrixxContext,
  ToolsRecord,
  V2Event,
  V2Registration,
  V2SessionDomain,
  V2ToolDomain,
} from "./tool/context"
export { createEventHandler } from "./tool/event"
export { createEventDispatcher } from "./tool/event-dispatch"
export type { Hooks } from "./tool/legacy-hooks"
export { createNativePluginContext } from "./tool/native-context"
export type { SkillContext } from "./tool/skill-context"
export { createSkillContext } from "./tool/skill-context"
export type { ToolCatalogResult } from "./tool/tool-catalog"
export { createToolCatalog } from "./tool/tool-catalog"
export { createToolExecuteAfterHandler } from "./tool/tool-execute-after"
export { createToolExecuteBeforeHandler } from "./tool/tool-execute-before"
