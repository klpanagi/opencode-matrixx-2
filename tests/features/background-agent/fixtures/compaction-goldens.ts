/**
 * Expected compaction snippets for the T-31 failure history rows.
 *
 * `TaskHistory.formatForCompaction` renders one line per history entry:
 *   `- **agent**[category](status): description | session: `ses_...`` (category omitted when absent)
 *
 * Each golden names the terminal failure path (matching a row in
 * `terminal-goldens.ts`), the task fields recorded on that path, and the
 * exact line the compaction context injector MUST contain once the failure
 * is recorded to history.
 */

export interface CompactionGolden {
  path: string
  agent: string
  category?: string
  status: string
  description: string
  sessionID: string
  line: string
  ownerTask: string
}

export const COMPACTION_GOLDENS: CompactionGolden[] = [
  {
    path: "session-error",
    agent: "task",
    status: "error",
    description: "failing session error task",
    sessionID: "ses_err_history",
    line: "- **task**(error): failing session error task | session: `ses_err_history`",
    ownerTask: "T-31 compaction history",
  },
  {
    path: "execution-failed",
    agent: "task",
    status: "error",
    description: "failing execution task",
    sessionID: "ses_fail_history",
    line: "- **task**(error): failing execution task | session: `ses_fail_history`",
    ownerTask: "T-31 compaction history",
  },
  {
    path: "wallclock",
    agent: "task",
    status: "error",
    description: "wallclock failure task",
    sessionID: "ses_harness",
    line: "- **task**(error): wallclock failure task | session: `ses_harness`",
    ownerTask: "T-31 compaction history",
  },
]
