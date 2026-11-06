/** context-injection barrel: explicit named re-exports of local submodules only. */

export type {
  MessageMeta,
  OriginalMessageContext,
  StoredMessage,
  TextPart,
  ToolPermission,
} from "./hook-bridge"
export {
  findFirstMessageWithAgent,
  findFirstMessageWithAgentFromSDK,
  findNearestMessageWithFields,
  findNearestMessageWithFieldsFromSDK,
  injectHookMessage,
  invalidateSdkMessageCache,
  MESSAGE_STORAGE,
  resolveMessageContext,
} from "./hook-bridge"
export type {
  ContextEntry,
  ContextPriority,
  ContextSourceType,
  InjectionStrategy,
  MessageContext,
  OutputParts,
  PendingContext,
  RegisterContextOptions,
} from "./injector"
export {
  ContextCollector,
  contextCollector,
  createContextInjectorMessagesTransformHook,
  MAX_MERGED_CHARS,
  MAX_PER_SOURCE_CHARS,
} from "./injector"
export {
  buildContextModeRoutingBlock,
  buildFallbackRoutingBlock,
  CONTEXT_MODE_INJECTOR_ID,
  CONTEXT_MODE_NOTICE_MESSAGE,
  CONTEXT_MODE_NOTICE_TITLE,
  containsContextModeMarker,
  createContextModeSystemTransformHook,
  HOOK_NAME,
  hashInjectionContent,
  MATRIXX_CONTEXT_MODE_MARKER,
} from "./routing"
