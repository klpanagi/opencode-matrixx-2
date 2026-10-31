import type { BackgroundManager } from "../../features/background-agent"
import type { V2Event } from "../../plugin/context"
import { log } from "../../shared/logger"

/**
 * Background notification hook - handles event routing to BackgroundManager.
 *
 * Notifications are now delivered directly via session.prompt({ noReply })
 * from the manager, so this hook only needs to handle event routing.
 * Thin router: logs the routing decision, then forwards unchanged.
 */
export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async (event: V2Event) => {
    const props = (event as unknown as { data?: Record<string, unknown> })
      .data
    const topLevelSessionID = (
      event as unknown as { sessionID?: unknown }
    ).sessionID
    const rawSessionID =
      typeof props?.sessionID === "string"
        ? (props.sessionID as string)
        : typeof topLevelSessionID === "string"
          ? topLevelSessionID
          : undefined
    if (rawSessionID !== undefined) {
      let task: { id?: string } | undefined
      try {
        task = (
          manager as unknown as {
            findBySession: (sid: string) => { id?: string } | undefined
          }
        ).findBySession(rawSessionID)
      } catch {
        task = undefined
      }
      if (task?.id !== undefined) {
        log("[background-notification] forward event to manager:", {
          type: event.type,
          sessionID: rawSessionID,
          taskId: task.id,
        })
      } else {
        log("[background-notification] ignore event: findBySession miss:", {
          type: event.type,
          sessionIDPrefix: rawSessionID.slice(0, 8),
        })
      }
    } else {
      log("[background-notification] ignore event: missing sessionID", {
        type: event.type,
      })
    }
    manager.handleEvent(event)
  }

  return {
    event: eventHandler,
  }
}
