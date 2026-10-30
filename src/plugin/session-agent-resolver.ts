import { log } from "../shared"
import type { SessionContextCarrier } from "../shared/session-context-source"
import { fetchSessionMessages } from "../shared/session-context-source"

export async function resolveSessionAgent(
  client: SessionContextCarrier,
  sessionId: string,
  timeoutMs = 5000,
): Promise<string | undefined> {
  try {
    const messages = await Promise.race([
      fetchSessionMessages(client, sessionId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Session agent resolve timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])

    for (const msg of messages) {
      const agent = msg.agent
      if (agent) {
        return agent
      }
    }
  } catch (error) {
    log("[session-agent-resolver] Failed to resolve agent from session", {
      sessionId,
      error: String(error),
    })
  }
  return undefined
}
