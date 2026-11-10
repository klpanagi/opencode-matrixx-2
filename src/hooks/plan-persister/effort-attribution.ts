import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { MatrixxConfig } from "../../config/schema"
import { checkboxOverlap } from "../../features/mission-state/plan-storage"
import type { MissionState } from "../../features/mission-state/types"
import { getStaleAfterMs, isTaskStale } from "../../features/task-session-scope/staleness"
import { getTaskDir, readJsonSafe } from "../../features/task-storage/storage"
import { resolveTasksConfig } from "../../shared/config/task-system-gating"
import { TaskObjectSchema } from "../../tools/task/types"
import { isTaskLinkedToMission, isTerminalTaskStatus } from "./task-link"

export interface AttributedTaskInput {
  taskId: string
  subject: string
  total: number
  tokenUsd: number
  planTodo?: string
}

export interface AttributeTodoEffortInput {
  checkboxTexts: string[]
  linkedTasks: AttributedTaskInput[]
}

export interface TodoEffortBucket {
  total: number
  tokenUsd: number
  taskIds: string[]
}

export interface AttributeTodoEffortResult {
  perTodoActual: Record<string, TodoEffortBucket>
  unassigned: Array<{ taskId: string; total: number; tokenUsd: number }>
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function bucket(): TodoEffortBucket {
  return { total: 0, tokenUsd: 0, taskIds: [] }
}

function addToBucket(perTodoActual: Record<string, TodoEffortBucket>, key: string, task: AttributedTaskInput): void {
  const entry = perTodoActual[key] ?? bucket()
  entry.total += finiteOrZero(task.total)
  entry.tokenUsd += finiteOrZero(task.tokenUsd)
  entry.taskIds.push(task.taskId)
  perTodoActual[key] = entry
}

export function attributeTodoEffort(input: AttributeTodoEffortInput): AttributeTodoEffortResult {
  const perTodoActual: Record<string, TodoEffortBucket> = {}
  const unassigned: AttributeTodoEffortResult["unassigned"] = []
  const boxes = input.checkboxTexts.filter((text) => text.trim().length > 0)

  for (const task of input.linkedTasks) {
    if (typeof task.planTodo === "string" && task.planTodo.length > 0) {
      if (boxes.includes(task.planTodo)) {
        addToBucket(perTodoActual, task.planTodo, task)
        continue
      }
      unassigned.push({ taskId: task.taskId, total: finiteOrZero(task.total), tokenUsd: finiteOrZero(task.tokenUsd) })
      continue
    }
    const matches = boxes.filter((box) => checkboxOverlap(box, task.subject).matched)
    if (matches.length === 1 && matches[0] !== undefined) {
      addToBucket(perTodoActual, matches[0], task)
      continue
    }
    unassigned.push({ taskId: task.taskId, total: finiteOrZero(task.total), tokenUsd: finiteOrZero(task.tokenUsd) })
  }

  return { perTodoActual, unassigned }
}

const TOP_BOX_TEXT_RE = /^[-*]\s*\[[ xX]\]\s*(.*)$/

export function collectCheckboxTexts(content: string): string[] {
  const texts: string[] = []
  for (const line of content.split("\n")) {
    const match = TOP_BOX_TEXT_RE.exec(line)
    if (match?.[1] !== undefined) {
      const text = match[1].trim()
      if (text.length > 0) texts.push(text)
    }
  }
  return texts
}

function readPlanTodo(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.planTodo
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readTaskEffort(metadata: Record<string, unknown> | undefined): { total: number; tokenUsd: number } {
  const effort = metadata?.effort
  if (typeof effort !== "object" || effort === null) return { total: 0, tokenUsd: 0 }
  const record = effort as { total?: unknown; tokenUsd?: unknown }
  return { total: finiteOrZero(record.total), tokenUsd: finiteOrZero(record.tokenUsd) }
}

export function collectAttributableTasks(
  directory: string,
  mission: MissionState,
  config: Partial<MatrixxConfig> = {},
): AttributedTaskInput[] {
  const taskDir = getTaskDir(config, directory)
  const staleAfterMs = getStaleAfterMs(config)
  if (!existsSync(taskDir)) return []
  let files: string[]
  try {
    files = readdirSync(taskDir).filter((f) => f.startsWith("T-") && f.endsWith(".json"))
  } catch {
    return []
  }
  const out: AttributedTaskInput[] = []
  for (const file of files) {
    const path = join(taskDir, file)
    const task = readJsonSafe(path, TaskObjectSchema)
    if (task === null) continue
    if (isTaskStale(path, staleAfterMs)) continue
    if (!isTerminalTaskStatus(task.status)) continue
    const decision = isTaskLinkedToMission(task, mission, {
      directory,
      sessionScoped: resolveTasksConfig(config).session_scoped,
      resolveParent: (parentID) => readJsonSafe(join(taskDir, `${parentID}.json`), TaskObjectSchema),
    })
    if (!decision.linked) continue
    const { total, tokenUsd } = readTaskEffort(task.metadata)
    if (total === 0 && tokenUsd === 0) continue
    out.push({ taskId: task.id, subject: task.subject, total, tokenUsd, planTodo: readPlanTodo(task.metadata) })
  }
  return out
}
