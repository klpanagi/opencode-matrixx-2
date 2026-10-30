import { log, normalizeSDKResponse } from "../shared"

interface SessionMessage {
  agent?: string
}

type SessionClient = {
  session: {
    messages: (opts: { path: { id: string } }) => Promise<{ data?: unknown[] }>
  }
}

export async function resolveSessionAgent(
  client: SessionClient,
  sessionId: string,
  timeoutMs = 5000,
): Promise<string | undefined> {
  try {
    const messagesResp = await Promise.race([
      client.session.messages({ path: { id: sessionId } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Session agent resolve timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
    const messages = normalizeSDKResponse(messagesResp, [] as SessionMessage[])

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
