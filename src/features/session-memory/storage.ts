import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { isSyntheticMessage, LOCK_RETRY_COUNT, MEMORY_DIR_NAME, MEMORY_FILE_NAME, MEMORY_LOCK_FILE_NAME, MEMORY_SUBDIR_NAME, STALE_LOCK_THRESHOLD_MS } from "./constants"
import { type MemoryEntry, type MemoryEntryInput, MemoryEntrySchema } from "./types"

export function getProjectMemoryDir(directory: string): string {
  return join(directory, MEMORY_DIR_NAME, MEMORY_SUBDIR_NAME)
}

export function getMemoryDir(directory?: string): string {
  return getProjectMemoryDir(directory ?? process.cwd())
}

export function getMemoryFilePath(directory?: string): string {
  return join(getMemoryDir(directory), MEMORY_FILE_NAME)
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  ensureDir(dir)

  const tempPath = `${filePath}.tmp.${Date.now()}`

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

export function acquireLock(dirPath: string): { acquired: boolean; release: () => void } {
  const lockPath = join(dirPath, MEMORY_LOCK_FILE_NAME)
  const lockId = randomUUID()

  const createLock = (timestamp: number) => {
    writeFileSync(lockPath, JSON.stringify({ id: lockId, timestamp }), {
      encoding: "utf-8",
      flag: "wx",
    })
  }

  const isStale = () => {
    try {
      const lockContent = readFileSync(lockPath, "utf-8")
      const lockData = JSON.parse(lockContent)
      const lockAge = Date.now() - lockData.timestamp
      return lockAge > STALE_LOCK_THRESHOLD_MS
    } catch {
      return true
    }
  }

  const tryAcquire = () => {
    const now = Date.now()
    try {
      createLock(now)
      return true
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return false
      }
      throw error
    }
  }

  ensureDir(dirPath)

  let acquired = tryAcquire()
  if (!acquired && isStale()) {
    try {
      unlinkSync(lockPath)
    } catch {
      // Ignore cleanup errors
    }
    acquired = tryAcquire()
  }

  if (!acquired) {
    return {
      acquired: false,
      release: () => {
        // No-op release for failed acquisition
      },
    }
  }

  return {
    acquired: true,
    release: () => {
      try {
        if (!existsSync(lockPath)) return
        const lockContent = readFileSync(lockPath, "utf-8")
        const lockData = JSON.parse(lockContent)
        if (lockData.id !== lockId) return
        unlinkSync(lockPath)
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

export async function acquireLockWithRetry(
  dirPath: string,
  retries = LOCK_RETRY_COUNT,
): Promise<{ acquired: boolean; release: () => void }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const lock = acquireLock(dirPath)
    if (lock.acquired) return lock
    if (attempt < retries - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 15 * 2 ** attempt))
    }
  }
  return { acquired: false, release: () => {} }
}

export function generateMemoryId(): string {
  return `mem-${randomUUID()}`
}

function toStoredEntry(input: MemoryEntryInput): MemoryEntry {
  const now = Date.now()
  const text = input.text
  const stored = {
    ...input,
    chars: input.chars ?? text.length,
    tokens: input.tokens ?? Math.ceil(text.length / 4),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  }
  return MemoryEntrySchema.parse(stored)
}

export function appendMemoryEntry(input: MemoryEntryInput, directory?: string): MemoryEntry | null {
  if (isSyntheticMessage(input.text)) return null
  const entry = toStoredEntry(input)
  const dir = getMemoryDir(directory)
  ensureDir(dir)
  const lock = acquireLock(dir)
  try {
    appendFileSync(join(dir, MEMORY_FILE_NAME), `${JSON.stringify(entry)}\n`, "utf-8")
  } finally {
    lock.release()
  }
  return entry
}

export function readMemoryEntries(directory?: string): MemoryEntry[] {
  const filePath = getMemoryFilePath(directory)
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, "utf-8")
  const entries: MemoryEntry[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      const result = MemoryEntrySchema.safeParse(parsed)
      if (result.success) entries.push(result.data)
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

export interface ListMemoryOptions {
  sessionId?: string
  includeRemoved?: boolean
}

export function listMemoryEntries(options: ListMemoryOptions = {}, directory?: string): MemoryEntry[] {
  const entries = readMemoryEntries(directory)
  return entries.filter((entry) => {
    if (!options.includeRemoved && entry.removed) return false
    if (options.sessionId && entry.sessionId !== options.sessionId) return false
    return true
  })
}
