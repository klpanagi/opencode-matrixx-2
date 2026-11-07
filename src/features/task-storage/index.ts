/** task-storage barrel: explicit named re-exports of local modules only. */

export {
  assertCurrentGeneration,
  currentTaskGeneration,
  readTaskGeneration,
  STALE_GENERATION_KIND,
  StaleGenerationError,
  withBumpedGeneration,
  writeTaskFenced,
} from "./generation"
export {
  acquireLock,
  acquireLockWithRetry,
  generateTaskId,
  getProjectTaskDir,
  getTaskDir,
  type LockHandle,
  type LockInfo,
  type LockResult,
  listTaskFiles,
  MAX_RETRIES,
  migrateLegacyTasksIfNeeded,
  RETRY_DELAY_MS,
  readJsonSafe,
  readJsonStrict,
  readLockFile,
  refreshLock,
  releaseLock,
  resolveTaskListId,
  StorageCorruptError,
  sanitizePathSegment,
  writeJsonAtomic,
} from "./storage"
export {
  type Task,
  TaskSchema,
  type TaskStatus,
  TaskStatusSchema,
} from "./types"
