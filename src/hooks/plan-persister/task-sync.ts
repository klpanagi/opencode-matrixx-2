/**
 * Filtered Plan Sync Pipeline
 *
 * Single choke point for task -> plan checkbox sync. Both entry points —
 * the task_update/task_create trigger (one linked terminal task) and the
 * plan-persister capture() fallback (linked scan) — flow through
 * applyFilteredSync: syncCheckboxes (Task 3) -> recount via Task 2
 * constants -> atomicWrite + upsertMetadataComment. Every decision is logged.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { MatrixxConfig } from "../../config/schema"
import { collectPlanEffort } from "../../features/agent-effort/plan-rollup"
import {
  atomicWrite,
  checkboxOverlap,
  countPlanProgressFromContent,
  ensurePlanDir,
  readMissionState,
  readPlanFile,
  syncCheckboxesDetailed,
  upsertMetadataComment,
} from "../../features/mission-state"
import { formatCompletionWarning, resolvePlanCompletion } from "../../features/mission-state/completion"
import type { MissionState, PlanMeta } from "../../features/mission-state/types"
import { parsePlanFrontMatter } from "../../features/plan-contract"
import { getTaskDir, readJsonSafe } from "../../features/task-storage/storage"
import { resolveTasksConfig } from "../../shared/config/task-system-gating"
import { log } from "../../shared/runtime/logger"
import { getGitHead } from "../../tools/handoff/git"
import type { TaskObject } from "../../tools/task/types"
import { TaskObjectSchema } from "../../tools/task/types"
import { attributeTodoEffort, collectAttributableTasks, collectCheckboxTexts } from "./effort-attribution"
import { collectLinkedTodos, isTaskLinkedToMission, isTerminalTaskStatus } from "./task-link"

const HOOK_NAME = "plan-sync"

export interface FilteredSyncInput {
  directory: string
  mission: MissionState
  planPath: string
  todos: Array<{ content: string; status: string }>
  actorSessionId: string
  matchSubject?: string
  config?: Partial<MatrixxConfig>
}

export interface MatchedBox {
  line: string
  shared: number
  score: number
}

export interface FilteredSyncResult {
  ok: boolean
  skippedReason?: string
  total: number
  completed: number
  flaggedVerification: string[]
  matched?: MatchedBox
}

function emptyResult(skippedReason: string): FilteredSyncResult {
  return { ok: false, skippedReason, total: 0, completed: 0, flaggedVerification: [] }
}

function findFlippedBox(before: string, after: string, subject: string): MatchedBox | undefined {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  let best: MatchedBox | undefined
  const limit = Math.min(beforeLines.length, afterLines.length)
  for (let i = 0; i < limit; i += 1) {
    const b = beforeLines[i]
    const a = afterLines[i]
    if (b === a || !b.includes("[ ]") || !a.includes("[x]")) continue
    const text = a.slice(a.indexOf("]") + 1).trim()
    const { shared, score } = checkboxOverlap(text, subject)
    if (best === undefined || shared > best.shared) best = { line: a.trim(), shared, score }
  }
  return best
}

function collectLinkedEffortInputs(
  directory: string,
  mission: MissionState,
  config: Partial<MatrixxConfig>,
): Array<{ taskId: string; effort?: { total?: unknown; tokenUsd?: unknown; computedAt?: unknown } | null; generation?: unknown }> {
  const sessionScoped = resolveTasksConfig(config).session_scoped
  const taskDir = getTaskDir(config, directory)
  const resolveParent = (parentID: string): TaskObject | null =>
    readJsonSafe(join(taskDir, `${parentID}.json`), TaskObjectSchema)
  let files: string[] = []
  try {
    files = readdirSync(taskDir).filter((f) => f.startsWith("T-") && f.endsWith(".json"))
  } catch {
    return []
  }
  const inputs: Array<{ taskId: string; effort?: { total?: unknown; tokenUsd?: unknown; computedAt?: unknown } | null; generation?: unknown }> = []
  for (const f of files) {
    const parsed = readJsonSafe(join(taskDir, f), TaskObjectSchema)
    if (parsed === null || !isTerminalTaskStatus(parsed.status)) continue
    const decision = isTaskLinkedToMission(parsed, mission, {
      directory,
      sessionScoped,
      resolveParent,
    })
    if (!decision.linked) continue
    const effort = parsed.metadata?.effort
    inputs.push({
      taskId: parsed.id,
      effort:
        effort !== null && typeof effort === "object"
          ? (effort as { total?: unknown; tokenUsd?: unknown; computedAt?: unknown })
          : null,
      generation: parsed.generation,
    })
  }
  return inputs
}

export async function applyFilteredSync(input: FilteredSyncInput): Promise<FilteredSyncResult> {
  const { directory, mission, planPath, todos, actorSessionId, matchSubject, config = {} } = input
  if (!existsSync(planPath)) {
    log(`[${HOOK_NAME}] Sync skipped: plan file missing`, { plan: planPath })
    return emptyResult("missing-plan-file")
  }
  const content = readPlanFile(planPath)
  if (content === null) {
    log(`[${HOOK_NAME}] Sync skipped: plan unreadable`, { plan: planPath })
    return emptyResult("plan-file-unreadable")
  }
  const { content: synced, flaggedVerification } = syncCheckboxesDetailed(content, todos)
  const progress = countPlanProgressFromContent(synced)
  const gitHead = await getGitHead(directory)
  const meta: PlanMeta = {
    id: mission.plan_name,
    updatedAt: new Date().toISOString(),
    sessionId: actorSessionId,
    todoTotal: progress.total,
    todoCompleted: progress.completed,
    gitHead: gitHead ?? undefined,
  }
  try {
    const rollup = collectPlanEffort(collectLinkedEffortInputs(directory, mission, config))
    if (rollup.taskCount > 0) {
      meta.effortActual = rollup
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Effort attribution skipped (fail-open)`, {
      plan: planPath,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  try {
    const attributable = collectAttributableTasks(directory, mission, config)
    const attribution = attributeTodoEffort({
      checkboxTexts: collectCheckboxTexts(synced),
      linkedTasks: attributable,
    })
    if (Object.keys(attribution.perTodoActual).length > 0) {
      meta.perTodoActual = attribution.perTodoActual
    }
    if (attribution.unassigned.length > 0) {
      log(`[${HOOK_NAME}] Effort unassigned to any TODO (fail-open)`, {
        plan: planPath,
        unassigned: attribution.unassigned.length,
      })
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Effort rollup skipped (fail-open)`, {
      plan: planPath,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  ensurePlanDir(directory)
  if (!atomicWrite(planPath, upsertMetadataComment(synced, meta))) {
    log(`[${HOOK_NAME}] Sync failed: plan write failed`, { plan: planPath })
    return { ...emptyResult("plan-write-failed"), flaggedVerification }
  }
  const matched = matchSubject === undefined ? undefined : findFlippedBox(content, synced, matchSubject)
  // Overlay (read-only): verdict + warn-only log. Counts in `progress`/`meta` above
  // are untouched; a mismatch is logged, never auto-flipped.
  const syncedFrontMatter = parsePlanFrontMatter(synced)
  const completionWarning =
    syncedFrontMatter === null
      ? null
      : formatCompletionWarning(resolvePlanCompletion(synced, syncedFrontMatter))
  if (completionWarning !== null) {
    log(`[${HOOK_NAME}] Completion mismatch (warn-only; counts unchanged)`, { plan: planPath, warning: completionWarning })
  }
  log(`[${HOOK_NAME}] Plan synced`, {
    plan: planPath,
    total: progress.total,
    completed: progress.completed,
    flagged: flaggedVerification.length,
    matched: matched?.line,
    confidence: matched === undefined ? undefined : { shared: matched.shared, score: matched.score },
  })
  return { ok: true, total: progress.total, completed: progress.completed, flaggedVerification, matched }
}

export interface SyncTriggerInput {
  directory: string
  task: TaskObject
  config?: Partial<MatrixxConfig>
}

export interface SyncTriggerResult extends FilteredSyncResult {
  linked: boolean
}

export async function maybeSyncTaskToPlans(input: SyncTriggerInput): Promise<SyncTriggerResult> {
  const { directory, task, config = {} } = input
  if (!isTerminalTaskStatus(task.status)) {
    return { ...emptyResult("non-terminal-status"), linked: false }
  }
  const mission = readMissionState(directory)
  if (mission?.active_plan === undefined) {
    log(`[${HOOK_NAME}] Sync skipped: no active mission`, { taskId: task.id })
    return { ...emptyResult("no-mission-state"), linked: false }
  }
  const sessionScoped = resolveTasksConfig(config).session_scoped
  const taskDir = getTaskDir(config, directory)
  const decision = isTaskLinkedToMission(task, mission, {
    directory,
    sessionScoped,
    resolveParent: (parentID) => readJsonSafe(join(taskDir, `${parentID}.json`), TaskObjectSchema),
  })
  if (!decision.linked) {
    log(`[${HOOK_NAME}] Sync skipped: task unlinked`, {
      taskId: task.id,
      plan: mission.active_plan,
      reason: decision.reason,
    })
    return { ...emptyResult(`task-unlinked:${decision.reason}`), linked: false }
  }
  log(`[${HOOK_NAME}] Sync attempt: linked terminal task`, {
    taskId: task.id,
    plan: mission.active_plan,
    status: task.status,
    via: decision.reason,
  })
  const result = await applyFilteredSync({
    directory,
    mission,
    planPath: mission.active_plan,
    todos: [{ content: task.subject, status: task.status }],
    actorSessionId: task.threadID,
    matchSubject: task.subject,
  })
  return { ...result, linked: true }
}

export { collectLinkedTodos }
