/** matrix-loop barrel: explicit named re-exports of local modules only. */
export {
  detectCompletionInSessionMessages,
  detectCompletionInTranscript,
  type OpenCodeSessionMessage,
} from "./completion-promise-detector"
export {
  verifyCompletion,
} from "./completion-verifier"
export {
  DEFAULT_COMPLETION_PROMISE,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_STATE_FILE,
  DEFAULT_VERIFICATION_AGENT,
  DEFAULT_VERIFICATION_MAX_RETRIES,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  HOOK_NAME,
} from "./constants"
export {
  buildContinuationPrompt,
} from "./continuation-prompt-builder"
export {
  injectContinuationPrompt,
} from "./continuation-prompt-injector"
export {
  createLoopSessionRecovery,
} from "./loop-session-recovery"
export {
  createLoopStateController,
} from "./loop-state-controller"
export {
  createMatrixLoopEventHandler,
} from "./matrix-loop-event-handler"
export {
  createMatrixLoopHook,
  type MatrixLoopHook,
} from "./matrix-loop-hook"
export {
  clearState,
  incrementIteration,
  readState,
  writeState,
} from "./storage"
export type {
  MatrixLoopOptions,
  MatrixLoopState,
} from "./types"
