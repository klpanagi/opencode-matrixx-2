// Compositional barrel for the tool-domain modules of the plugin root.
// Explicit named re-exports only — no logic, no side effects.
// Deep imports (`./tool/chat-message`) remain the primary path; this barrel
// exists for the Phase 4 composition root.

export { createAvailableCategories } from "./available-categories"
export { createChatMessageHandler } from "./chat-message"
export { createChatParamsHandler } from "./chat-params"
export type {
  Cleanup,
  MatrixxContext,
  ToolsRecord,
  V2AgentEditor,
  V2AgentInfo,
  V2AgentTransformDomain,
  V2App,
  V2DomainEditor,
  V2Event,
  V2ExecuteAfterEvent,
  V2ExecuteBeforeEvent,
  V2HookCallback,
  V2Location,
  V2McpEditor,
  V2McpTransformDomain,
  V2PermissionApi,
  V2Project,
  V2Registration,
  V2SessionCompactionEvent,
  V2SessionContextEvent,
  V2SessionDomain,
  V2SessionPromptEvent,
  V2SystemPart,
  V2ToolContext,
  V2ToolDomain,
  V2ToolEditor,
  V2ToolInfo,
  V2ToolResult,
  V2TransformDomain,
} from "./context"
export { createEventHandler } from "./event"
export type {
  DispatchGuard,
  EventDispatcher,
  EventDispatcherDeps,
  EventDispatcherStats,
  EventSubscriber,
} from "./event-dispatch"
export {
  createEventDispatcher,
  DEDUPLICATE_WINDOW_MS,
  DISPATCH_BACKOFF_BASE_MS,
  DISPATCH_BACKOFF_MAX_MS,
  defaultSleep,
  dispatchBackoffMs,
} from "./event-dispatch"
export type {
  Auth,
  Event,
  Hooks,
  Message,
  Model,
  ModelV2,
  Part,
  Permission,
  Provider,
  ProviderContext,
  ProviderV2,
  SDKConfig,
  UserMessage,
} from "./legacy-hooks"
export { createNativePluginContext } from "./native-context"
export { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"
export { normalizeSessionStatusToIdle } from "./session-status-normalizer"
export type { SkillContext } from "./skill-context"
export { createSkillContext } from "./skill-context"
export type { ToolCatalogResult } from "./tool-catalog"
export { createToolCatalog } from "./tool-catalog"
export { createToolDefinitionHandler, toolAuthoringEntry } from "./tool-definition"
export { createToolExecuteAfterHandler } from "./tool-execute-after"
export { createToolExecuteBeforeHandler } from "./tool-execute-before"
export type {
  ToolEditorLike,
  ToolPermissionDecision,
  ToolPermissionEffect,
  ToolPolicyOptions,
} from "./tool-policy"
export {
  applyDisabledToolsTransform,
  BDD_FILE_EXTENSION,
  decideToolPermission,
  directoryHasMatch,
  isConstructAgentEnabled,
  LOOK_AT_MEDIA_EXTENSIONS,
  PDF_FILE_EXTENSION,
  shouldEnableBddTools,
  shouldEnableKnowledgeHubConfirm,
  shouldEnableLookAt,
  shouldEnablePdfFigures,
  shouldEnablePresetTools,
  shouldEnableSessionCleanup,
  TOOL_GATING_MAX_DEPTH,
  TOOL_GATING_MAX_ENTRIES,
  TOOL_GATING_SKIP_DIRS,
} from "./tool-policy"
