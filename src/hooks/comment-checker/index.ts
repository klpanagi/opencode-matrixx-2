/** comment-checker barrel: explicit named re-exports of local modules only. */
export { createCommentCheckerHooks } from "./hook"
export { registerPendingCall, startPendingCallCleanup, takePendingCall } from "./pending-calls"
export type { PendingCall, PendingEdit } from "./types"
