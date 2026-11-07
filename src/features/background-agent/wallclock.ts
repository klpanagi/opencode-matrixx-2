export const MAX_WALLCLOCK_TIMEOUT_MS = 2_147_483_647

export interface WallclockFireContext {
  taskId: string
  elapsedMs: number
  limitMs: number
}

export type WallclockFireCallback = (ctx: WallclockFireContext) => void

export interface WallclockPersistedDeadline {
  deadlineMono: number
  wallStart: number
  limitMs: number
}

export interface WallclockClock {
  nowWall?: () => number
  nowMono?: () => number
}

function defaultMonoNow(): number {
  return Math.floor(performance.now())
}

interface WallclockEntry {
  deadlineAt: number
  deadlineMono: number
  wallStart: number
  limitMs: number
  fired: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

export function remainingMs(startedAtMs: number, timeoutMs: number, nowMs: number = Date.now()): number {
  return startedAtMs + timeoutMs - nowMs
}

export function remainingMono(deadlineMono: number, nowMono: number): number {
  return Math.max(deadlineMono - nowMono, 0)
}

export function isWallclockEnabled(timeoutMs: number | undefined): timeoutMs is number {
  return timeoutMs !== undefined && timeoutMs !== 0
}

export class WallclockSupervisor {
  private entries: Map<string, WallclockEntry> = new Map()
  private readonly nowWall: () => number
  private readonly nowMono: () => number

  constructor(clock: WallclockClock = {}) {
    this.nowWall = clock.nowWall ?? Date.now
    this.nowMono = clock.nowMono ?? defaultMonoNow
  }

  arm(taskId: string, startedAtMs: number, timeoutMs: number | undefined, onFire: WallclockFireCallback): void {
    if (!isWallclockEnabled(timeoutMs)) return
    const limitMs = Math.min(timeoutMs, MAX_WALLCLOCK_TIMEOUT_MS)
    this.disarm(taskId)
    const deadlineAt = startedAtMs + limitMs
    const deadlineMono = this.nowMono() + limitMs
    const delayMs = remainingMono(deadlineMono, this.nowMono())
    let timer: ReturnType<typeof setTimeout> | undefined
    const entry: WallclockEntry = { deadlineAt, deadlineMono, wallStart: startedAtMs, limitMs, fired: false, timer }
    timer = setTimeout(() => {
      if (entry.fired) return
      entry.fired = true
      this.entries.delete(taskId)
      onFire({ taskId, elapsedMs: this.nowWall() - startedAtMs, limitMs })
    }, delayMs)
    entry.timer = timer
    this.entries.set(taskId, entry)
  }

  resume(taskId: string, persisted: WallclockPersistedDeadline, onFire: WallclockFireCallback): void {
    const limitMs = Math.min(persisted.limitMs, MAX_WALLCLOCK_TIMEOUT_MS)
    this.disarm(taskId)
    const delayMs = remainingMono(persisted.deadlineMono, this.nowMono())
    const wallStart = persisted.wallStart
    const deadlineAt = wallStart + limitMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const entry: WallclockEntry = {
      deadlineAt,
      deadlineMono: persisted.deadlineMono,
      wallStart,
      limitMs,
      fired: false,
      timer,
    }
    timer = setTimeout(() => {
      if (entry.fired) return
      entry.fired = true
      this.entries.delete(taskId)
      onFire({ taskId, elapsedMs: this.nowWall() - wallStart, limitMs })
    }, delayMs)
    entry.timer = timer
    this.entries.set(taskId, entry)
  }

  snapshot(taskId: string): WallclockPersistedDeadline | undefined {
    const entry = this.entries.get(taskId)
    if (entry === undefined) return undefined
    return { deadlineMono: entry.deadlineMono, wallStart: entry.wallStart, limitMs: entry.limitMs }
  }

  disarm(taskId: string): boolean {
    const entry = this.entries.get(taskId)
    if (entry === undefined) return false
    entry.fired = true
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    this.entries.delete(taskId)
    return true
  }

  disarmAll(): void {
    for (const entry of this.entries.values()) {
      entry.fired = true
      if (entry.timer !== undefined) clearTimeout(entry.timer)
    }
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }

  getDeadlineAt(taskId: string): number | undefined {
    return this.entries.get(taskId)?.deadlineAt
  }
}
