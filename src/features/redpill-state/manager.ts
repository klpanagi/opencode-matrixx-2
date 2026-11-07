import { log } from "../../shared/runtime/logger"

const HOOK_NAME = "redpill-state"

const sessionStates = new Map<string, "enabled" | "disabled">()

export function getRedpillState(
  sessionID: string,
): "enabled" | "disabled" | undefined {
  return sessionStates.get(sessionID)
}

export function enableRedpill(sessionID: string): void {
  sessionStates.set(sessionID, "enabled")
  log(`[${HOOK_NAME}] Redpill enabled for session`, { sessionID })
}

export function disableRedpill(sessionID: string): void {
  sessionStates.set(sessionID, "disabled")
  log(`[${HOOK_NAME}] Redpill disabled for session`, { sessionID })
}

export function clearRedpillState(sessionID: string): void {
  sessionStates.delete(sessionID)
}

/** @internal */
export function _resetRedpillStateForTesting(): void {
  sessionStates.clear()
}
