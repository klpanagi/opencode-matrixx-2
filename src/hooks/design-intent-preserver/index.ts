/** design-intent-preserver barrel: explicit named re-exports of local modules only. */
export {
  CONSTRUCT_INDICATORS,
  HOOK_NAME,
  IDEMPOTENCY_MARKER,
  INTENT_PRESERVATION_BLOCK,
  PHASE_TRANSITION_PATTERN,
  PLANS_DIR,
} from "./constants"
export {
  createDesignIntentPreserverHook,
} from "./hook"
export {
  extractPromptText,
  findMostRecentPlanFile,
  hasPhaseTransition,
  type MessagePart,
  planHasConstruct,
} from "./phase-detector"
