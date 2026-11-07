import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join } from "node:path"
import type { z } from "zod"
import type { MatrixxConfig } from "../../config/schema"
import { getOpenCodeConfigDir } from "../../shared/config/opencode-config-dir"
import { resolveTasksConfig } from "../../shared/config/task-system-gating"
import { log } from "../../shared/runtime/logger"
import { TypedReadError } from "./read-errors"

export function getProjectTaskDir(directory: string): string {
  return join(directory, ".matrixx", "tasks")
}

export function getTaskDir(config: Partial<MatrixxConfig> = {}, directory?: string): string {
  const tasksConfig = resolveTasksConfig(config)
  const storagePath = tasksConfig.storage_path

  if (storagePath) {
    return isAbsolute(storagePath) ? storagePath : join(directory ?? process.cwd(), storagePath)
  }

  if (tasksConfig.scope === "global" || !directory) {
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    const listId = resolveTaskListId(config)
    return join(configDir, "tasks", listId)
  }

  return getProjectTaskDir(directory)
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "default"
}

export function resolveTaskListId(config: Partial<MatrixxConfig> = {}): string {
  const envId = process.env.ULTRAWORK_TASK_LIST_ID?.trim()
  if (envId) return sanitizePathSegment(envId)


  const configId = resolveTasksConfig(config).task_list_id?.trim()
  if (configId) return sanitizePathSegment(configId)

  return sanitizePathSegment(basename(process.cwd()))
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export class StorageCorruptError extends Error {
  path: string
  byteSize: number
  reason: string
  constructor(path: string, byteSize: number, reason: string) {
    super(`[task-storage] corrupt read: path=${path} bytes=${byteSize} reason=${reason}`)
    this.name = "StorageCorruptError"
    this.path = path
    this.byteSize = byteSize
    this.reason = reason
  }
}

export function readJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const byteSize = Buffer.byteLength(content, "utf-8")
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      log(`[task-storage] readJsonSafe parse failure`, { path: filePath, byteSize, reason: error instanceof Error ? error.message : String(error) })
      return null
    }
    const result = schema.safeParse(parsed)

    if (!result.success) {
      log(`[task-storage] readJsonSafe schema mismatch`, { path: filePath, byteSize })
      return null
    }

    return result.data
  } catch (error) {
    let byteSize = 0
    try {
      byteSize = statSync(filePath).size
    } catch {
      byteSize = 0
    }
    log(`[task-storage] readJsonSafe read failure`, { path: filePath, byteSize, reason: error instanceof Error ? error.message : String(error) })
    return null
  }
}

export function readJsonStrict<T>(filePath: string, schema: z.ZodType<T>): T {
  const result = readJsonSafe(filePath, schema)
  if (result !== null) return result
  let byteSize = 0
  try {
    byteSize = statSync(filePath).size
  } catch {
    byteSize = 0
  }
  throw new StorageCorruptError(filePath, byteSize, "unreadable or invalid")
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  ensureDir(dir)

  const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`

  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

const STALE_LOCK_THRESHOLD_MS = 30000

export const MAX_RETRIES = 4
export const RETRY_DELAY_MS = 15

export async function acquireLockWithRetry(
  dirPath: string,
  retries = MAX_RETRIES,
): Promise<{ acquired: boolean; release: () => void }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const lock = acquireLock(dirPath)
    if (lock.acquired) return lock
    if (attempt < retries - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** attempt))
    }
  }
  return { acquired: false, release: () => {} }
}

export function generateTaskId(): string {
  return `T-${randomUUID()}`
}

export function listTaskFiles(config: Partial<MatrixxConfig> = {}, directory?: string): string[] {
  const dir = getTaskDir(config, directory)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f.startsWith('T-'))
    .map((f) => f.replace('.json', ''))
}

export function migrateLegacyTasksIfNeeded(
  config: Partial<MatrixxConfig>,
  directory: string,
): { migrated: number; legacyDir: string; projectDir: string } {
  const projectDir = getProjectTaskDir(directory)
  const legacyDir = join(getOpenCodeConfigDir({ binary: "opencode" }), "tasks", resolveTaskListId(config))

  if (existsSync(projectDir)) {
    try {
      const existing = readdirSync(projectDir).filter((f) => f.startsWith("T-") && f.endsWith(".json"))
      if (existing.length > 0) {
        return { migrated: 0, legacyDir, projectDir }
      }
    } catch {
      // Ignore read errors, proceed to migration check
    }
  }

  if (!existsSync(legacyDir)) {
    return { migrated: 0, legacyDir, projectDir }
  }

  let files: string[] = []
  try {
    files = readdirSync(legacyDir).filter((f) => f.startsWith("T-") && f.endsWith(".json"))
  } catch {
    return { migrated: 0, legacyDir, projectDir }
  }

  if (files.length === 0) {
    return { migrated: 0, legacyDir, projectDir }
  }

  ensureDir(projectDir)

  let migrated = 0
  for (const file of files) {
    const src = join(legacyDir, file)
    const dest = join(projectDir, file)
    if (existsSync(dest)) continue
    try {
      const content = readFileSync(src, "utf-8")
      writeFileSync(dest, content, "utf-8")
      migrated++
    } catch {
      // Ignore individual file copy errors
    }
  }

  if (migrated > 0) {
    log(`[task-storage] Migrated ${migrated} legacy tasks from ${legacyDir} to ${projectDir}`)
  }

  return { migrated, legacyDir, projectDir }
}

export interface LockInfo {
  id: string
  ownerId: string
  pid: number
  generation: number
  timestamp: number
}

export interface LockHandle {
  acquired: boolean
  ownerId?: string
  release: () => void
}

export type LockResult = { ok: true } | { ok: false; error: TypedReadError }

function lockFilePath(dirPath: string): string {
  return join(dirPath, ".lock")
}

function parseLockInfo(content: string): LockInfo | null {
  try {
    const data = JSON.parse(content) as Partial<LockInfo>
    if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp)) return null
    const id =
      typeof data.id === "string" ? data.id : typeof data.ownerId === "string" ? data.ownerId : null
    if (id === null) return null
    return {
      id,
      ownerId: typeof data.ownerId === "string" ? data.ownerId : id,
      pid: typeof data.pid === "number" ? data.pid : -1,
      generation: typeof data.generation === "number" ? data.generation : 0,
      timestamp: data.timestamp,
    }
  } catch {
    return null
  }
}

export function readLockFile(dirPath: string): LockInfo | null {
  try {
    if (!existsSync(lockFilePath(dirPath))) return null
    return parseLockInfo(readFileSync(lockFilePath(dirPath), "utf-8"))
  } catch {
    return null
  }
}

function isStaleInfo(info: LockInfo | null): boolean {
  if (info === null) return true
  return Date.now() - info.timestamp > STALE_LOCK_THRESHOLD_MS
}

function ownerMatches(info: LockInfo, ownerId: string): boolean {
  return info.ownerId === ownerId || info.id === ownerId
}

function foreignLockError(lockPath: string, info: LockInfo): TypedReadError {
  return new TypedReadError("Locked", lockPath, 0, ["foreign owner:", info.ownerId].join(" "))
}

export function releaseLock(dirPath: string, ownerId: string): LockResult {
  const lockPath = lockFilePath(dirPath)
  if (!existsSync(lockPath)) {
    return { ok: false, error: new TypedReadError("NotFound", lockPath, 0, "no lock held") }
  }
  let info: LockInfo | null
  try {
    info = parseLockInfo(readFileSync(lockPath, "utf-8"))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new TypedReadError("TransientIO", lockPath, 0, reason) }
  }
  if (info === null) {
    try {
      unlinkSync(lockPath)
    } catch {
    }
    return { ok: false, error: new TypedReadError("Corrupt", lockPath, 0, "unparseable lock evicted") }
  }
  if (!ownerMatches(info, ownerId)) {
    log("[task-storage] foreign unlock refused", { path: lockPath, owner: info.ownerId })
    return { ok: false, error: foreignLockError(lockPath, info) }
  }
  try {
    unlinkSync(lockPath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new TypedReadError("TransientIO", lockPath, 0, reason) }
  }
  return { ok: true }
}

export function refreshLock(dirPath: string, ownerId: string): LockResult {
  const lockPath = lockFilePath(dirPath)
  if (!existsSync(lockPath)) {
    return { ok: false, error: new TypedReadError("NotFound", lockPath, 0, "no lock held") }
  }
  let info: LockInfo | null
  try {
    info = parseLockInfo(readFileSync(lockPath, "utf-8"))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new TypedReadError("TransientIO", lockPath, 0, reason) }
  }
  if (info === null) {
    return { ok: false, error: new TypedReadError("Corrupt", lockPath, 0, "unparseable lock") }
  }
  if (!ownerMatches(info, ownerId)) {
    log("[task-storage] foreign refresh refused", { path: lockPath, owner: info.ownerId })
    return { ok: false, error: foreignLockError(lockPath, info) }
  }
  try {
    const renewed: LockInfo = { ...info, timestamp: Date.now() }
    writeFileSync(lockPath, JSON.stringify(renewed), { encoding: "utf-8" })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: new TypedReadError("TransientIO", lockPath, 0, reason) }
  }
  return { ok: true }
}

export function acquireLock(dirPath: string): LockHandle {
  const lockPath = join(dirPath, ".lock")
  const lockId = randomUUID()

  const createLock = (timestamp: number, generation: number) => {
    writeFileSync(
      lockPath,
      JSON.stringify({ id: lockId, ownerId: lockId, pid: process.pid, generation, timestamp }),
      { encoding: "utf-8", flag: "wx" },
    )
  }

  const tryAcquire = (generation: number) => {
    const now = Date.now()
    try {
      createLock(now, generation)
      return true
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return false
      }
      throw error
    }
  }

  ensureDir(dirPath)

  let acquired = tryAcquire(0)
  if (!acquired) {
    const current = readLockFile(dirPath)
    if (isStaleInfo(current)) {
      const fresh = readLockFile(dirPath)
      if (isStaleInfo(fresh)) {
        try {
          unlinkSync(lockPath)
        } catch {
        }
        acquired = tryAcquire((fresh?.generation ?? -1) + 1)
      }
    }
  }

  if (!acquired) {
    return {
      acquired: false,
      release: () => {
      },
    }
  }

  return {
    acquired: true,
    ownerId: lockId,
    release: () => {
      const result = releaseLock(dirPath, lockId)
      if (!result.ok && result.error.kind === "Locked") {
        log("[task-storage] release owner mismatch", { path: lockPath })
      }
    },
  }
}
