import * as path from "node:path"

export const HUB_WRITE_APPROVAL_TTL_MS = 10 * 60 * 1000

const MAX_APPROVAL_SESSIONS = 128
const MAX_APPROVAL_PATHS_PER_SESSION = 256

const approvals = new Map<string, Map<string, number>>()

export function normalizeApprovedPath(absPath: string): string {
  return path.normalize(absPath)
}

function evictEarliestPath(bySession: Map<string, number>): void {
  let earliestKey: string | null = null
  let earliest = Number.POSITIVE_INFINITY
  for (const [approved, expiresAt] of bySession) {
    if (expiresAt < earliest) {
      earliest = expiresAt
      earliestKey = approved
    }
  }
  if (earliestKey !== null) {
    bySession.delete(earliestKey)
  }
}

function evictEarliestSession(): void {
  let earliestKey: string | null = null
  let earliest = Number.POSITIVE_INFINITY
  for (const [sessionID, bySession] of approvals) {
    for (const expiresAt of bySession.values()) {
      if (expiresAt < earliest) {
        earliest = expiresAt
        earliestKey = sessionID
      }
    }
  }
  if (earliestKey !== null) {
    approvals.delete(earliestKey)
  }
}

export function approveHubWrite(sessionID: string, absPath: string, ttlMs: number = HUB_WRITE_APPROVAL_TTL_MS): string {
  const normalized = normalizeApprovedPath(absPath)
  let bySession = approvals.get(sessionID)
  if (!bySession) {
    bySession = new Map()
    approvals.set(sessionID, bySession)
  }
  bySession.set(normalized, Date.now() + ttlMs)
  while (bySession.size > MAX_APPROVAL_PATHS_PER_SESSION) {
    evictEarliestPath(bySession)
  }
  while (approvals.size > MAX_APPROVAL_SESSIONS) {
    evictEarliestSession()
  }
  return normalized
}

export function isHubWriteApproved(sessionID: string, absPath: string): boolean {
  const bySession = approvals.get(sessionID)
  if (!bySession) {
    return false
  }
  const candidate = normalizeApprovedPath(absPath)
  const now = Date.now()
  let allowed = false
  for (const [approved, expiresAt] of bySession) {
    if (expiresAt <= now) {
      bySession.delete(approved)
      continue
    }
    if (candidate === approved) {
      allowed = true
    }
  }
  if (bySession.size === 0) {
    approvals.delete(sessionID)
  }
  return allowed
}

export function clearHubWriteApprovals(): void {
  approvals.clear()
}
