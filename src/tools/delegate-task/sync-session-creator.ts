import type { NativeClient } from "./types"

export interface SyncSessionModel {
  providerID: string
  modelID: string
  variant?: string
}

export async function createSyncSession(
  client: NativeClient,
  input: {
    parentSessionID: string
    agentToUse: string
    description: string
    defaultDirectory: string
    model?: SyncSessionModel
  }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = (await client.session
    .get({ sessionID: input.parentSessionID })
    .catch(() => null)) as { directory?: string } | null
  const parentDirectory = parentSession?.directory ?? input.defaultDirectory

  try {
    const created = (await client.session.create({
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
      agent: input.agentToUse,
      ...(input.model
        ? {
            model: {
              id: input.model.modelID,
              providerID: input.model.providerID,
              ...(input.model.variant !== undefined ? { variant: input.model.variant } : {}),
            },
          }
        : {}),
    })) as { id: string }

    return { ok: true, sessionID: created.id, parentDirectory }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Failed to create session: ${message}` }
  }
}
