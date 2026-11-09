/// <reference types="bun-types" />
import type { ManagerTimerHandle } from "../../../../src/features/background-agent/manager/types"

interface ScheduledTimer {
  at: number
  callback: () => void
}

export interface FakeClock {
  now(): number
  advance(ms: number): void
  setTimeout(callback: () => void, delayMs?: number): ManagerTimerHandle
  clearTimeout(handle: ManagerTimerHandle): void
  readonly pendingCount: number
}

export function createFakeClock(startAt = 0): FakeClock {
  const timers = new Map<number, ScheduledTimer>()
  let nextId = 1

  function remove(handle: ManagerTimerHandle): boolean {
    return timers.delete(handle as unknown as number)
  }

  function fireDue(target: number, state: { current: number }): void {
    while (true) {
      let nextIdDue: number | undefined
      let nextTimer: ScheduledTimer | undefined
      for (const [id, timer] of timers) {
        if (timer.at > target) continue
        if (!nextTimer || timer.at < nextTimer.at) {
          nextIdDue = id
          nextTimer = timer
        }
      }
      if (nextIdDue === undefined || nextTimer === undefined) return
      timers.delete(nextIdDue)
      state.current = Math.max(state.current, nextTimer.at)
      nextTimer.callback()
    }
  }

  const state = { current: startAt }

  return {
    now(): number {
      return state.current
    },
    advance(ms: number): void {
      if (ms < 0) throw new Error("advance(ms) requires ms >= 0")
      const target = state.current + ms
      fireDue(target, state)
      state.current = target
    },
    setTimeout(callback: () => void, delayMs = 0): ManagerTimerHandle {
      const id = nextId
      nextId += 1
      timers.set(id, { at: state.current + Math.max(0, delayMs), callback })
      return id as unknown as ManagerTimerHandle
    },
    clearTimeout(handle: ManagerTimerHandle): void {
      remove(handle)
    },
    get pendingCount(): number {
      return timers.size
    },
  }
}
