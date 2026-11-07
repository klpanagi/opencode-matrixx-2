/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { WallclockSupervisor } from "../../../src/features/background-agent/wallclock"

describe("WallclockSupervisor monotonic clock (B10)", () => {
  test("Date.now jump does not shift monotonic deadline delay", async () => {
    //#given
    let wallNow = 1_000_000
    let monoNow = 5_000
    const supervisor = new WallclockSupervisor({
      nowWall: () => wallNow,
      nowMono: () => monoNow,
    })
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error capture delay without real waiting
    globalThis.setTimeout = ((cb: () => void, ms: number) => {
      delays.push(ms)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    try {
      //#when
      supervisor.arm("t-skew", wallNow, 60_000, () => {})
      // simulate +10min wallclock jump AFTER arm (suspend skew)
      wallNow += 600_000
      monoNow += 1_000
      supervisor.resume("t-skew-resumed", { deadlineMono: 65_000, wallStart: 1_000_000, limitMs: 60_000 }, () => {})
    } finally {
      globalThis.setTimeout = origSetTimeout
    }

    //#then
    expect(delays.length).toBe(2)
    // arm delay must equal limitMs (mono delta), immune to wall jump
    expect(delays[0]).toBe(60_000)
    // resume: remaining = 65_000 - 6_000 = 59_000, not shifted by +10min wall jump
    expect(delays[1]).toBe(59_000)
    supervisor.disarmAll()
  })

  test("resume recomputes remaining and clamps to zero when expired", async () => {
    //#given
    let monoNow = 100_000
    const supervisor = new WallclockSupervisor({ nowMono: () => monoNow })
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error capture delay without real waiting
    globalThis.setTimeout = ((cb: () => void, ms: number) => {
      delays.push(ms)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout
    try {
      //#when
      supervisor.resume("t-expired", { deadlineMono: 50_000, wallStart: 0, limitMs: 10_000 }, () => {})
    } finally {
      globalThis.setTimeout = origSetTimeout
    }

    //#then
    expect(delays[0]).toBe(0)
    supervisor.disarmAll()
  })

  test("snapshot persists deadlineMono and wallStart for revive", () => {
    //#given
    let monoNow = 7_000
    const supervisor = new WallclockSupervisor({ nowMono: () => monoNow })
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error avoid real timer
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
    try {
      //#when
      supervisor.arm("t-snap", 2_000, 30_000, () => {})
      const snap = supervisor.snapshot("t-snap")

      //#then
      expect(snap).toBeDefined()
      expect(snap!.deadlineMono).toBe(37_000)
      expect(snap!.wallStart).toBe(2_000)
      expect(snap!.limitMs).toBe(30_000)
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
    supervisor.disarmAll()
  })
})
