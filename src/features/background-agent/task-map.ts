import type { BackgroundTask } from "./types"

type SessionNormalizer = (sessionID: string) => string

/**
 * Task registry keyed by task id that also maintains secondary indices for the
 * two lookup shapes the manager performs on every poll/notification:
 *
 * - `sessionID -> taskId` (O(1) `bySession`)
 * - `parentSessionID -> Set<taskId>` (O(k) `byParent`)
 *
 * The map stays a `Map` so every existing `set/get/delete/clear/size/values`
 * call site keeps working. Because tasks are also mutated in place — most
 * notably `task.sessionID` is assigned after insertion (`manager/lifecycle.ts`)
 * — mutations raise `dirty`, and a lookup that misses rebuilds once from the
 * live entries before reporting absence. A hit never pays for a rebuild.
 */
export class TaskMap<T extends BackgroundTask> extends Map<string, T> {
  private readonly sessionIndex = new Map<string, string>()
  private readonly parentIndex = new Map<string, Set<string>>()
  private readonly normalizeSessionID: SessionNormalizer

  dirty = false

  constructor(normalizeSessionID: SessionNormalizer = (sessionID) => sessionID) {
    super()
    this.normalizeSessionID = normalizeSessionID
  }

  override set(key: string, task: T): this {
    const previous = super.get(key)
    if (previous) this.unindex(previous)
    super.set(key, task)
    this.index(task)
    this.dirty = true
    return this
  }

  override delete(key: string): boolean {
    const previous = super.get(key)
    if (!previous) return false
    this.unindex(previous)
    const deleted = super.delete(key)
    this.dirty = true
    return deleted
  }

  override clear(): void {
    this.sessionIndex.clear()
    this.parentIndex.clear()
    super.clear()
    this.dirty = true
  }

  bySession(sessionID: string): T | undefined {
    const taskId = this.sessionIndex.get(this.normalizeSessionID(sessionID))
    if (taskId === undefined) return undefined
    return super.get(taskId)
  }

  byParent(parentSessionID: string): T[] {
    const taskIds = this.parentIndex.get(parentSessionID)
    if (!taskIds) return []
    const result: T[] = []
    for (const taskId of taskIds) {
      const task = super.get(taskId)
      if (task) result.push(task)
    }
    return result
  }

  rebuild(): void {
    this.sessionIndex.clear()
    this.parentIndex.clear()
    for (const task of super.values()) {
      this.index(task)
    }
    this.dirty = false
  }

  private index(task: T): void {
    if (task.sessionID !== undefined && task.sessionID.length > 0) {
      const key = this.normalizeSessionID(task.sessionID)
      if (!this.sessionIndex.has(key)) this.sessionIndex.set(key, task.id)
    }
    if (task.parentSessionID) {
      const taskIds = this.parentIndex.get(task.parentSessionID)
      if (taskIds) taskIds.add(task.id)
      else this.parentIndex.set(task.parentSessionID, new Set([task.id]))
    }
  }

  private unindex(task: T): void {
    if (task.sessionID !== undefined && task.sessionID.length > 0) {
      const key = this.normalizeSessionID(task.sessionID)
      if (this.sessionIndex.get(key) === task.id) this.sessionIndex.delete(key)
    }
    const taskIds = this.parentIndex.get(task.parentSessionID)
    if (taskIds) {
      taskIds.delete(task.id)
      if (taskIds.size === 0) this.parentIndex.delete(task.parentSessionID)
    }
  }
}
