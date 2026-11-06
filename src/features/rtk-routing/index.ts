/** rtk-routing barrel: explicit named re-exports of local modules only. */
export {
  buildRtkRoutingBlock,
  containsRtkMarker,
  MATRIXX_RTK_MARKER,
} from "./routing-block"
export {
  createRtkSystemTransformHook,
  HOOK_NAME,
  hashRtkInjectionContent,
  RTK_INJECTOR_ID,
  RTK_NOTICE_MESSAGE,
  RTK_NOTICE_TITLE,
  type RtkSystemTransformOptions,
} from "./system-transform"
