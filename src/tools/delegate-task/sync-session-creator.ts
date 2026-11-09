import { buildTaskTitle } from "./task-title"
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
    category?: string
    model?: SyncSessionModel
  }
): Promise<{ ok: true; sessionID: string } | { ok: false; error: string }> {
  try {
    const created = (await client.session.create({
      parentID: input.parentSessionID,
      title: buildTaskTitle(input.description, input.agentToUse, input.category),
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

    return { ok: true, sessionID: created.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Failed to create session: ${message}` }
  }
}
