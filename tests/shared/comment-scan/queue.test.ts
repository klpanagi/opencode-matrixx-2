/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { createBoundedQueue, QueueTimeoutError } from "../../../src/shared/comment-scan/queue"

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Pure microtask flushes: no timers, no sleeps, so every assertion is deterministic.
async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

interface FakeTimer {
  readonly dueAt: number
  readonly fire: () => void
}

class FakeClock {
  private time = 0
  private readonly timers: FakeTimer[] = []

  readonly now = (): number => this.time

  readonly schedule = (fire: () => void, ms: number): (() => void) => {
    const timer: FakeTimer = { dueAt: this.time + ms, fire }
    this.timers.push(timer)
    return () => {
      const index = this.timers.indexOf(timer)
      if (index >= 0) this.timers.splice(index, 1)
    }
  }

  get scheduledCount(): number {
    return this.timers.length
  }

  advance(ms: number): void {
    this.time += ms
    const due = this.timers.filter((timer) => timer.dueAt <= this.time)
    for (const timer of due) {
      this.timers.splice(this.timers.indexOf(timer), 1)
    }
    for (const timer of due) {
      timer.fire()
    }
  }
}

describe("createBoundedQueue", () => {
  test("defaults to concurrency 2", async () => {
    //#given
    const queue = createBoundedQueue()
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const runs = gates.map((gate) =>
      queue.run(async () => {
        await gate.promise
      }),
    )

    //#when
    await drainMicrotasks()

    //#then
    expect(queue.active).toBe(2)
    expect(queue.pending).toBe(1)

    for (const gate of gates) {
      gate.resolve()
    }
    await Promise.all(runs)
    expect(queue.active).toBe(0)
    expect(queue.pending).toBe(0)
  })

  test("never runs more than the configured concurrency", async () => {
    //#given
    const queue = createBoundedQueue({ concurrency: 2 })
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const started: number[] = []
    let running = 0
    let peak = 0
    const makeTask = (index: number) => async (): Promise<number> => {
      started.push(index)
      running += 1
      peak = Math.max(peak, running)
      await gates[index].promise
      running -= 1
      return index
    }

    //#when
    const results = [queue.run(makeTask(0)), queue.run(makeTask(1)), queue.run(makeTask(2))]
    await drainMicrotasks()

    //#then
    expect(peak).toBe(2)
    expect(queue.active).toBe(2)
    expect(queue.pending).toBe(1)
    expect(started).toEqual([0, 1])

    //#when
    gates[0].resolve()
    await drainMicrotasks()

    //#then
    expect(started).toEqual([0, 1, 2])
    expect(queue.pending).toBe(0)

    gates[1].resolve()
    gates[2].resolve()
    expect(await Promise.all(results)).toEqual([0, 1, 2])
  })

  test("admits pending tasks in FIFO order", async () => {
    //#given
    const queue = createBoundedQueue({ concurrency: 1 })
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()]
    const started: number[] = []
    const completed: number[] = []
    const runs = gates.map((gate, index) =>
      queue.run(async () => {
        started.push(index)
        await gate.promise
        completed.push(index)
        return index
      }),
    )
    await drainMicrotasks()

    //#when
    for (const gate of gates) {
      gate.resolve()
      await drainMicrotasks()
    }

    //#then
    expect(started).toEqual([0, 1, 2, 3])
    expect(completed).toEqual([0, 1, 2, 3])
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3])
  })

  test("applies backpressure instead of dropping work past maxPending", async () => {
    //#given
    let overflowCalls = 0
    const queue = createBoundedQueue({
      concurrency: 1,
      maxPending: 2,
      onOverflow: () => {
        overflowCalls += 1
      },
    })
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()]
    const started: number[] = []
    let lastSettledEarly = false
    const runs = gates.map((gate, index) =>
      queue.run(async () => {
        started.push(index)
        await gate.promise
        return index
      }),
    )
    runs[runs.length - 1].then(() => {
      lastSettledEarly = true
    })

    //#when
    await drainMicrotasks()

    //#then
    expect(queue.pending).toBe(3)
    expect(overflowCalls).toBe(1)
    expect(lastSettledEarly).toBe(false)

    //#when
    for (const gate of gates) {
      gate.resolve()
      await drainMicrotasks()
    }

    //#then
    expect(started).toEqual([0, 1, 2, 3])
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3])
    expect(queue.active).toBe(0)
    expect(queue.pending).toBe(0)
    expect(overflowCalls).toBe(1)
  })

  test("rejects with QueueTimeoutError via the injected scheduler and frees the slot", async () => {
    //#given
    const clock = new FakeClock()
    const queue = createBoundedQueue({
      concurrency: 1,
      taskTimeoutMs: 20,
      schedule: clock.schedule,
      now: clock.now,
    })
    const stuck = deferred<string>()
    const timedOut = queue.run(() => stuck.promise)
    await drainMicrotasks()
    expect(queue.active).toBe(1)

    //#when
    expect(clock.scheduledCount).toBe(1)
    clock.advance(20)
    await expect(timedOut).rejects.toBeInstanceOf(QueueTimeoutError)
    const error = await captureError(timedOut)
    expect(error instanceof QueueTimeoutError ? error.elapsedMs : -1).toBe(20)
    expect(queue.active).toBe(0)
    expect(queue.pending).toBe(0)

    //#when
    const next = await queue.run(async () => "ok")

    //#then
    expect(next).toBe("ok")
  })
  test("preserves a successful task's resolved value", async () => {
    //#given
    const queue = createBoundedQueue({ concurrency: 1 })

    //#when
    // `: number` is the type-level assertion: the contract is Promise<T>, never T | undefined.
    const value: number = await queue.run(async () => 42)

    //#then
    expect(value).toBe(42)
  })

  test("keeps draining after a task rejects", async () => {
    //#given
    const queue = createBoundedQueue({ concurrency: 1 })
    const boom = new Error("boom")
    const failure = queue.run(async () => {
      throw boom
    })
    const after = queue.run(async () => "after")

    //#when
    const error = await captureError(failure)

    //#then
    expect(error).toBe(boom)
    expect(await after).toBe("after")
    expect(queue.active).toBe(0)
    expect(queue.pending).toBe(0)
  })

  test("a task that throws synchronously does not wedge the queue", async () => {
    //#given
    const queue = createBoundedQueue({ concurrency: 1 })
    const failure = queue.run((): Promise<never> => {
      throw new Error("sync boom")
    })
    const after = queue.run(async () => "after")

    //#when
    const error = await captureError(failure)

    //#then
    expect(error instanceof Error ? error.message : null).toBe("sync boom")
    expect(await after).toBe("after")
    expect(queue.active).toBe(0)
  })
})
