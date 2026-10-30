import type { NativeClient } from "./types"

export async function createSyncSession(
  client: NativeClient,
  input: { parentSessionID: string; agentToUse: string; description: string; defaultDirectory: string }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = (await client.session
    .get({ sessionID: input.parentSessionID })
    .catch(() => null)) as { directory?: string } | null
  const parentDirectory = parentSession?.directory ?? input.defaultDirectory

  try {
    const created = (await client.session.create({
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
    })) as { id: string }

    return { ok: true, sessionID: created.id, parentDirectory }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Failed to create session: ${message}` }
  }
}
