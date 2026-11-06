/** context-mode-routing barrel: explicit named re-exports of local modules only. */
export {
  buildContextModeRoutingBlock,
  buildFallbackRoutingBlock,
  containsContextModeMarker,
  MATRIXX_CONTEXT_MODE_MARKER,
} from "./routing-block"
export {
  CONTEXT_MODE_INJECTOR_ID,
  CONTEXT_MODE_NOTICE_MESSAGE,
  CONTEXT_MODE_NOTICE_TITLE,
  createContextModeSystemTransformHook,
  HOOK_NAME,
  hashInjectionContent,
} from "./system-transform"
