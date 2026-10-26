import type { MemoryEntry } from "./types"

export interface RetentionPolicy {
  staleSessionDays?: number
  deletedSessionDays?: number
  orphanBlobDays?: number
}

export interface RetentionReport {
  stale: string[]
  deleted: string[]
  orphaned: string[]
  skippedPinned: string[]
}

const DAY_MS = 86400e3

/** Cutoff timestamp: entries with updatedAt < cutoff are expired. */
export function retentionCutoff(days: number, now = Date.now()): number {
  return now - days * DAY_MS
}

function isExpired(updatedAt: number, days: number, now: number): boolean {
  return updatedAt < retentionCutoff(days, now)
}

function isOrphan(entry: MemoryEntry): boolean {
  return entry.text.trim().length === 0 || entry.sessionId.trim().length === 0
}

/**
 * Dry-run retention scan. Pure — never mutates input.
 * stale undefined = disabled (no-op). Pinned entries are always skipped.
 */
export function pruneReport(
  entries: MemoryEntry[],
  policy: RetentionPolicy = {},
  now = Date.now(),
): RetentionReport {
  const report: RetentionReport = { stale: [], deleted: [], orphaned: [], skippedPinned: [] }
  const deletedDays = policy.deletedSessionDays ?? 30
  const orphanDays = policy.orphanBlobDays ?? 14
  const staleDays = policy.staleSessionDays

  for (const entry of entries) {
    if (entry.pinned) {
      report.skippedPinned.push(entry.id)
      continue
    }
    if (entry.removed) {
      if (isExpired(entry.updatedAt, deletedDays, now)) report.deleted.push(entry.id)
      continue
    }
    if (isOrphan(entry)) {
      if (isExpired(entry.updatedAt, orphanDays, now)) report.orphaned.push(entry.id)
      continue
    }
    if (staleDays !== undefined && isExpired(entry.updatedAt, staleDays, now)) {
      report.stale.push(entry.id)
    }
  }
  return report
}

export interface PruneResult {
  entries: MemoryEntry[]
  report: RetentionReport
}

/**
 * Apply retention as tombstones (never hard-delete). Pure — returns new array.
 * deleted/orphan/stale matches get text redacted to [removed] / [pruned:id].
 * Pinned entries are always skipped.
 */
export function prune(
  entries: MemoryEntry[],
  policy: RetentionPolicy = {},
  now = Date.now(),
): PruneResult {
  const report = pruneReport(entries, policy, now)
  const tombstoned = new Set([...report.stale, ...report.deleted])
  const orphaned = new Set(report.orphaned)
  const next = entries.map((entry) => {
    if (tombstoned.has(entry.id)) {
      return { ...entry, removed: true, text: "[removed]", updatedAt: now }
    }
    if (orphaned.has(entry.id)) {
      return { ...entry, removed: true, text: `[pruned:${entry.id}]`, updatedAt: now }
    }
    return { ...entry }
  })
  return { entries: next, report }
}
