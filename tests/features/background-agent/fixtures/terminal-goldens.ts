/**
 * Terminal-path goldens for the behaviour-neutral finalizer (T-11 / PR-1a).
 *
 * One row per terminal transition. Each row describes the observable outcome
 * that MUST stay identical while the six terminal call sites are routed
 * through `finalizeTask`:
 *
 * - `historyRecorded`: a terminal history row for the task exists in
 *   `rt.taskHistory` (status === the row's `status`).
 * - `notifications`: number of parent notifications delivered.
 * - `bodyIncludesError`: the notification text contains `**Error:**`.
 * - `errorOnTask` / `errorOnHandle`: `task.error` is set and the persisted
 *   handle carries the same error.
 *
 * `ownerTask` names the test that owns the row. All six rows are owned by
 * `finalize-characterization.test.ts` in PR-1a; later tasks extend the
 * assertions without changing the values:
 * - T-22 owns the cancel notification decision (`cancel-notify`).
 * - T-31 owns the failure history rows.
 * - T-32 owns notification counts.
 */

export interface TerminalGolden {
  path: string
  status: string
  historyRecorded: boolean
  notifications: number
  bodyIncludesError: boolean
  errorOnTask: boolean
  errorOnHandle: boolean
  ownerTask: string
}

export const TERMINAL_GOLDENS: TerminalGolden[] = [
  {
    path: "session.idle",
    status: "completed",
    historyRecorded: true,
    notifications: 1,
    bodyIncludesError: false,
    errorOnTask: false,
    errorOnHandle: false,
    ownerTask: "finalize-characterization.test.ts (PR-1a); T-32 notification count",
  },
  {
    path: "session.execution.succeeded",
    status: "completed",
    historyRecorded: true,
    notifications: 1,
    bodyIncludesError: false,
    errorOnTask: false,
    errorOnHandle: false,
    ownerTask: "finalize-characterization.test.ts (PR-1a); T-32 notification count",
  },
  {
    path: "cancel",
    status: "cancelled",
    historyRecorded: true,
    notifications: 0,
    bodyIncludesError: false,
    errorOnTask: false,
    errorOnHandle: false,
    ownerTask: "finalize-characterization.test.ts (PR-1a); T-22 cancel-notify",
  },
  {
    path: "session.error",
    status: "error",
    historyRecorded: false,
    notifications: 1,
    bodyIncludesError: true,
    errorOnTask: true,
    errorOnHandle: true,
    ownerTask: "finalize-characterization.test.ts (PR-1a); T-31 failure history",
  },
  {
    path: "session.execution.failed",
    status: "error",
    historyRecorded: false,
    notifications: 1,
    bodyIncludesError: true,
    errorOnTask: true,
    errorOnHandle: true,
    ownerTask: "finalize-characterization.test.ts (PR-1a); T-31 failure history",
  },
  {
    path: "wall-clock",
    status: "error",
    historyRecorded: false,
    notifications: 0,
    bodyIncludesError: false,
    errorOnTask: true,
    errorOnHandle: true,
    ownerTask: "finalize-characterization.test.ts (PR-1a); wall-clock no-notify",
  },
]
