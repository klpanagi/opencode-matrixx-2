/** comment-checker barrel: explicit named re-exports of local modules only. */
export {
  type CheckResult,
  ensureCliAvailable,
  getCommentCheckerPath,
  getCommentCheckerPathSync,
  type HookInput,
  isCliAvailable,
  runCommentChecker,
  startBackgroundInit,
} from "./cli"
export {
  getCommentCheckerCliPathPromise,
  initializeCommentCheckerCli,
  isCliPathUsable,
  processApplyPatchEditsWithCli,
  processWithCli,
} from "./cli-runner"
export {
  ensureCommentCheckerBinary,
  getBinaryName,
  getCacheDir,
  getCachedBinaryPath,
} from "./downloader"
export {
  createCommentCheckerHooks,
} from "./hook"
export {
  registerPendingCall,
  startPendingCallCleanup,
  takePendingCall,
} from "./pending-calls"
export type {
  PendingCall,
} from "./types"
