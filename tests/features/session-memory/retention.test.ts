import { describe, expect, test } from "bun:test"
import { prune, pruneReport, retentionCutoff } from "../../../src/features/session-memory/retention"
import type { MemoryEntry } from "../../../src/features/session-memory/types"

const NOW = 1_700_000_000_000
const DAY = 86400e3

function entry(over: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    sessionId: "s1",
    messageId: "m1",
    scope: "session",
    text: "hello",
    chars: 5,
    tokens: 2,
    pinned: false,
    removed: false,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    ...over,
  }
}

describe("retention", () => {
  test("cutoff subtracts days in ms", () => {
    //#given a day count and fixed now
    //#when computing the cutoff
    //#then cutoff equals now minus days*86400e3
    expect(retentionCutoff(30, NOW)).toBe(NOW - 30 * DAY)
  })

  test("stale undefined is no-op for fresh active entries", () => {
    //#given an old active entry with no stale policy
    //#when running dry-run report
    //#then stale list stays empty
    const entries = [entry({ id: "a", updatedAt: NOW - 400 * DAY })]
    expect(pruneReport(entries, {}, NOW).stale).toEqual([])
  })

  test("stale policy tombstones old active entries", () => {
    //#given an old active entry and stale window
    //#when pruning
    //#then text becomes [removed] and removed flag set
    const entries = [entry({ id: "a", updatedAt: NOW - 10 * DAY })]
    const { entries: next, report } = prune(entries, { staleSessionDays: 7 }, NOW)
    expect(report.stale).toEqual(["a"])
    expect(next[0]?.text).toBe("[removed]")
    expect(next[0]?.removed).toBe(true)
  })

  test("deleted entries past 30d tombstone to [removed]", () => {
    //#given a removed entry older than 30d
    //#when running dry-run report
    //#then it appears in deleted list
    const entries = [entry({ id: "d", removed: true, updatedAt: NOW - 31 * DAY })]
    expect(pruneReport(entries, {}, NOW).deleted).toEqual(["d"])
  })

  test("orphan blobs past 14d tombstone to [pruned:id]", () => {
    //#given an empty-text orphan older than 14d
    //#when pruning
    //#then text becomes [pruned:id]
    const entries = [entry({ id: "o", text: "   ", updatedAt: NOW - 15 * DAY })]
    const { entries: next, report } = prune(entries, {}, NOW)
    expect(report.orphaned).toEqual(["o"])
    expect(next[0]?.text).toBe("[pruned:o]")
  })

  test("pinned entries are always skipped", () => {
    //#given a pinned old removed entry
    //#when pruning
    //#then it is skipped and untouched
    const entries = [entry({ id: "p", pinned: true, removed: true, updatedAt: NOW - 100 * DAY })]
    const { entries: next, report } = prune(entries, { staleSessionDays: 1 }, NOW)
    expect(report.skippedPinned).toEqual(["p"])
    expect(next[0]?.removed).toBe(true)
    expect(next[0]?.text).toBe("hello")
  })

  test("pruneReport is dry-run and does not mutate", () => {
    //#given entries scanned by dry-run
    //#when comparing before and after
    //#then input array is unchanged
    const entries = [entry({ id: "a", updatedAt: NOW - 10 * DAY })]
    const snapshot = JSON.stringify(entries)
    pruneReport(entries, { staleSessionDays: 7 }, NOW)
    expect(JSON.stringify(entries)).toBe(snapshot)
  })
})
