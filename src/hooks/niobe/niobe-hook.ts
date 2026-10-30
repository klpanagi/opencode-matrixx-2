import type { NativePluginContext } from "../../shared/session-context-source"
import { createNiobeEventHandler } from "./event-handler"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { NiobeHookOptions, SessionState } from "./types"

export function createNiobeHook(ctx: NativePluginContext, options?: NiobeHookOptions) {
  const sessions = new Map<string, SessionState>()
  const pendingFilePaths = new Map<string, string>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = { promptFailureCount: 0 }
      sessions.set(sessionID, state)
    }
    return state
  }

  return {
    handler: createNiobeEventHandler({ ctx, options, sessions, getState }),
    "tool.execute.before": createToolExecuteBeforeHandler({ ctx, pendingFilePaths }),
    "tool.execute.after": createToolExecuteAfterHandler({ ctx, pendingFilePaths }),
  }
}
