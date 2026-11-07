/** stop-continuation-guard barrel: explicit named re-exports of local modules only. */
export {
  createStopContinuationGuardHook,
  type StopContinuationGuard,
} from "./hook"
export {
  DEFAULT_STOP_DEADLINE_MS,
  DEFAULT_STOP_POLL_INTERVAL_MS,
  DeadlineExceededError,
  isDeadlineExceeded,
  type StopDeadlineDeps,
  type StopDeadlineOptions,
  type StopDeadlineResult,
  stopWithDeadline,
} from "./stop-deadline"
