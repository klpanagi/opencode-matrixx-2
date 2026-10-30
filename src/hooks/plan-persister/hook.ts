/**
 * Plan Persister Hook
 *
 * Continuation hook that persists active plan state (todos + metadata)
 * to the plan file on session.idle, and builds rehydration context
 * for injection after compaction.
 */

import { existsSync } from "node:fs"
import { readMissionState } from "../../features/mission-state"
import { buildRehydrationContext } from "../../features/mission-state/rehydrate"
import type { PlanPersistenceOptions } from "../../features/mission-state/types"
import type { MatrixxContext } from "../../plugin/context"
import { log } from "../../shared/logger"
import { collectLinkedTodos } from "./task-link"
import { applyFilteredSync } from "./task-sync"

const HOOK_NAME = "plan-persister"

import type { V2Event } from "../../plugin/context"
export interface PlanPersister {
  buildRehydrationContext: (sessionID: string) => string | null
  capture: (sessionID: string) => Promise<void>
  event: (event: V2Event) => Promise<void>
}

export function createPlanPersister(
  _ctx: MatrixxContext,
  options: PlanPersistenceOptions,
): PlanPersister {
  const { directory } = options

  const capture = async (sessionID: string): Promise<void> => {
    if (!sessionID) return

    const mission = readMissionState(directory)
    if (!mission?.active_plan) return

    // Only capture for sessions that are part of this mission
    if (!mission.session_ids?.includes(sessionID)) return

    const planPath = mission.active_plan
    if (!existsSync(planPath)) return

    // Filtered pipeline: strict task read + mission linkage only.
    // Foreign sessions never vote; drifted files log as unknown.
    const { todos } = collectLinkedTodos(directory, mission)

    // A zero-vote list needs no guard. `syncCheckboxesDetailed` returns every
    // line verbatim when no todo matches (plan-storage.ts:139-142) and only
    // ever checks, never unchecks (:143-144), so the unconditional write
    // refreshes the metadata stamp without touching a single checkbox.
    if (todos.length === 0) {
      log(`[${HOOK_NAME}] No mission-linked tasks; stamping plan only`, {
        sessionID,
        plan: planPath,
      })
    }

    await applyFilteredSync({
      directory,
      mission,
      planPath,
      todos,
      actorSessionId: sessionID,
    })
  }

  const event = async (event: V2Event): Promise<void> => {
    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return
      await capture(sessionID)
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (!sessionID) return
      // On compaction, capture latest state before it's lost
      await capture(sessionID)
      return
    }
  }

  const buildRehydrationCtx = (_sessionID: string): string | null => {
    const ctx = buildRehydrationContext(directory)
    return ctx?.directive ?? null
  }

  return { capture, event, buildRehydrationContext: buildRehydrationCtx }
}
