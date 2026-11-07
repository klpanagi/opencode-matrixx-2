import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { log } from "../../shared"
import { buildLabeledTitle } from "../../shared/agent/agent-label"
import { TASK_TTL_MS } from "./constants"
import type { BackgroundTask } from "./types"

/**
 * File-backed handle index for background tasks.
 *
 * Mirrors the `task-storage` pattern: one file per handle under a
 * project-scoped `.matrixx/bg-handles/` directory, written atomically via
 * `tmp + renameSync`. Only a lightweight index is persisted — prompts,
 * progress, results, errors and tool-call windows stay ephemeral.
 *
 * This lets a freshly-created `BackgroundManager` recover previously-created
 * `bg_*` handles after a plugin/process restart.
 *
 * Stale-handle guard: every handle carries a `generation` counter. Removing a
 * handle (explicit delete or TTL sweep) bumps a per-task tombstone
 * (`<taskId>.gen`), and the next write for that id embeds the bumped value.
 * `readHandle` with an expected generation rejects mismatches, so a handle
 * captured before removal can never resolve to a new task reusing the id.
 */

export const BG_HANDLE_DIR_NAME = "bg-handles"
export const BG_HANDLE_FILE_PREFIX = "bg_"

export const BgHandleSchema = z
  .object({
    taskId: z.string(),
    parentSessionID: z.string(),
    parentMessageID: z.string(),
    description: z.string().default("Background task"),
    title: z.string().optional(),
    agent: z.string(),
    status: z.enum(["pending", "running", "completed", "error", "cancelled", "interrupt", "stopped", "statusUncertain"]),
    sessionID: z.string().optional(),
    // compat-only: retained for handles persisted by older builds, no producer in current code.
    terminalReason: z
      .enum(["queue-saturated", "no-output", "uncertain", "aborted", "stale", "nested-depth-exceeded", "wall-clock-timeout", "expired"])
      .optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
        variant: z.string().optional(),
        temperature: z.number().optional(),
      })
      .optional(),
    category: z.string().optional(),
    concurrencyGroup: z.string().optional(),
    queuedAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    generation: z.number().int().nonnegative().default(0),
  })
  .strict()

export type BgHandle = z.infer<typeof BgHandleSchema>

/** Project-scoped handle directory: `<project>/.matrixx/bg-handles`. */
export function getBgHandleDir(directory: string): string {
  return join(directory, ".matrixx", BG_HANDLE_DIR_NAME)
}

/** One file per handle id: `<project>/.matrixx/bg-handles/<taskId>.json`. */
export function getHandlePath(directory: string, taskId: string): string {
  return join(getBgHandleDir(directory), `${taskId}.json`)
}

/** Tombstone holding the bumped generation after a handle is removed. Never ends in `.json`, so index scans skip it. */
export function getGenerationPath(directory: string, taskId: string): string {
  return join(getBgHandleDir(directory), `${taskId}.gen`)
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/** Single source of truth for the OpenCode subagent session title format. */
export function buildSubagentTitle(description: unknown, agent: unknown, category?: unknown): string {
  return buildLabeledTitle({ description, agent, category, background: true });
}

/** Project a full task onto the lightweight, persistable handle index. */
export function toHandle(task: BackgroundTask): BgHandle {
  return {
    taskId: task.id,
    parentSessionID: task.parentSessionID,
    parentMessageID: task.parentMessageID,
    description: task.description,
    agent: task.agent,
    status: task.status,
    sessionID: task.sessionID,
    terminalReason: task.terminalReason,
    model: task.model,
    category: task.category,
    concurrencyGroup: task.concurrencyGroup,
    title: buildSubagentTitle(task.description, task.agent),
    queuedAt: task.queuedAt?.getTime(),
    startedAt: task.startedAt?.getTime(),
    completedAt: task.completedAt?.getTime(),
    generation: 0,
  }
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`

  try {
    writeFileSync(tempPath, content, "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors — the original write error is the signal.
    }
    throw error
  }
}

function readGenerationFile(directory: string, taskId: string): number {
  try {
    const raw = readFileSync(getGenerationPath(directory, taskId), "utf-8").trim()
    const parsed = Number.parseInt(raw, 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

export function currentGeneration(directory: string, taskId: string): number {
  const tombstone = readGenerationFile(directory, taskId)
  const existing = readHandleFile(getHandlePath(directory, taskId))
  return Math.max(tombstone, existing?.generation ?? 0)
}

export function bumpGeneration(directory: string, taskId: string): void {
  try {
    ensureDir(getBgHandleDir(directory))
    atomicWriteFileSync(getGenerationPath(directory, taskId), `${currentGeneration(directory, taskId) + 1}\n`)
  } catch {
    // Best-effort: a lost bump only weakens the stale guard, never breaks deletes.
  }
}

/**
 * Atomically persist a handle: write to a temp file then rename into place.
 * The embedded generation is the current counter for the id, so a handle
 * recreated after removal carries a strictly greater value than the removed one.
 * Throws on write failure; callers decide how to surface it.
 */
export function writeHandle(directory: string, task: BackgroundTask): void {
  const filePath = getHandlePath(directory, task.id)
  ensureDir(dirname(filePath))
  atomicWriteFileSync(filePath, JSON.stringify({ ...toHandle(task), generation: currentGeneration(directory, task.id) }, null, 2))
}

function readHandleFile(filePath: string): BgHandle | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    const result = BgHandleSchema.safeParse(parsed)

    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Read one handle by id. When `expectedGeneration` is given, a handle whose
 * embedded generation differs (stale reference, or a new task reusing the id
 * after removal) is rejected with a log line and `null` is returned.
 */
export function readHandle(directory: string, taskId: string, expectedGeneration?: number): BgHandle | null {
  const handle = readHandleFile(getHandlePath(directory, taskId))
  if (!handle) {
    return null
  }
  if (handle.generation < readGenerationFile(directory, taskId)) {
    log(`[bg-handles] Rejecting on-disk stale handle ${taskId} (gen ${handle.generation})`)
    return null
  }
  if (expectedGeneration !== undefined && handle.generation !== expectedGeneration) {
    log(`[bg-handles] Rejecting stale handle ${taskId} (expected gen ${expectedGeneration}, found ${handle.generation})`)
    return null
  }
  return handle
}

/** Read and validate every persisted handle. Invalid/corrupt files are skipped. */
export function readHandles(directory: string): BgHandle[] {
  const dir = getBgHandleDir(directory)
  if (!existsSync(dir)) {
    return []
  }

  const handles: BgHandle[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(BG_HANDLE_FILE_PREFIX) || !name.endsWith(".json")) {
      continue
    }

    const handle = readHandleFile(join(dir, name))
    if (handle) {
      handles.push(handle)
    }
  }

  return handles
}

/** Remove the handle file for a task id. Returns true when a file was deleted. */
export function deleteHandleFile(directory: string, taskId: string): boolean {
  const filePath = getHandlePath(directory, taskId)

  try {
    if (!existsSync(filePath)) {
      return false
    }

    unlinkSync(filePath)
    bumpGeneration(directory, taskId)
    return true
  } catch {
    return false
  }
}

/**
 * Bounded TTL sweep: delete handle files whose most recent timestamp is older
 * than `ttlMs` (default 30 min). Corrupt/unreadable files are swept too so the
 * directory cannot grow without bound. Returns the number of files removed.
 */
export function sweepStaleHandles(directory: string, ttlMs = TASK_TTL_MS, now = Date.now()): number {
  const dir = getBgHandleDir(directory)
  if (!existsSync(dir)) {
    return 0
  }

  let removed = 0
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(BG_HANDLE_FILE_PREFIX) || !name.endsWith(".json")) {
      continue
    }

    const filePath = join(dir, name)
    const handle = readHandleFile(filePath)
    const timestamp = handle?.completedAt ?? handle?.startedAt ?? handle?.queuedAt

    if (handle && timestamp !== undefined && now - timestamp <= ttlMs) {
      continue
    }

    try {
      unlinkSync(filePath)
      if (handle) {
        bumpGeneration(directory, handle.taskId)
      }
      removed++
    } catch {
      // Ignore individual unlink failures — sweep is best-effort and bounded.
    }
  }

  if (removed > 0) {
    log(`[bg-handles] Swept ${removed} stale handle file(s) from ${dir}`)
  }

  return removed
}
