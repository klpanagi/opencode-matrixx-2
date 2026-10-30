import type { BackgroundManager } from "../../features/background-agent"
import type { V2Event } from "../../plugin/context"

/**
 * Background notification hook - handles event routing to BackgroundManager.
 *
 * Notifications are now delivered directly via session.prompt({ noReply })
 * from the manager, so this hook only needs to handle event routing.
 */
export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async (event: V2Event) => {
    manager.handleEvent(event)
  }

  return {
    event: eventHandler,
  }
}
