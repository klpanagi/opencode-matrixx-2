export const SUBAGENT_CONTROL_DESCRIPTION = `Control a native background subagent session spawned by the subagent tool.

Actions:
- cancel: interrupt a running child session by sessionID. A repeat cancel of
  the same session is a clean already-cancelled error, never a throw.
- wait: block until the child session goes idle or the timeout elapses.
  An already-finished session returns immediately; a timeout is a clean
  still-running result, never an error throw.

Output reading is NOT part of this tool. After wait reports finished, read
the child's messages with session_read (or session_search / session_info).
A background completion also injects a synthetic <subagent> message into the
parent session automatically.`

export const SUBAGENT_CONTROL_NAME = "subagent_control"

export const DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS = 60000

export const MAX_SUBAGENT_WAIT_TIMEOUT_MS = 600000
