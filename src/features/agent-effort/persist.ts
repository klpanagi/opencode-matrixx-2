import { join } from "node:path"
import { log } from "../../shared/runtime/logger"
import {
  acquireLockWithRetry,
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
} from "../task-storage/storage"
import { type Task, TaskSchema } from "../task-storage/types"
import type { EffortRecord } from "./types"

function isSameEffort(task: Task, record: EffortRecord): boolean {
  const effort = task.metadata?.effort
  if (typeof effort !== "object" || effort === null) return false
  const stored = effort as { generation?: unknown; computedAt?: unknown }
  return stored.generation === task.generation && stored.computedAt === record.computedAt
}

export async function attachEffortToTask(
  directory: string,
  taskId: string,
  record: EffortRecord,
): Promise<boolean> {
  const taskDir = getTaskDir({}, directory)
  const taskPath = join(taskDir, `${taskId}.json`)

  const task = readJsonSafe(taskPath, TaskSchema)
  if (task === null) return false
  if (isSameEffort(task, record)) return false

  const lock = await acquireLockWithRetry(taskDir)
  if (!lock.acquired) return false

  try {
    const current = readJsonSafe(taskPath, TaskSchema)
    if (current === null) return false
    if (isSameEffort(current, record)) return false

    const updated: Task = {
      ...current,
      metadata: {
        ...(current.metadata ?? {}),
        effort: { ...record, generation: current.generation },
      },
    }
    writeJsonAtomic(taskPath, updated)
    return true
  } catch (error) {
    log("[agent-effort] failed to persist effort to task", {
      path: taskPath,
      taskId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    lock.release()
  }
}
