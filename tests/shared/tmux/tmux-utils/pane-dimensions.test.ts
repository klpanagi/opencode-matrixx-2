import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TMUX_PROBE_TIMEOUT_MS } from "../../../../src/shared/tmux/constants"
import { getPaneDimensions } from "../../../../src/shared/tmux/tmux-utils/pane-dimensions"
import { resetTmuxPathCache } from "../../../../src/tools/interactive-bash/tmux-path-resolver"

const originalSpawn = Bun.spawn
let calls: string[][] = []
let procs: StubProc[] = []

interface StubProc {
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  killed: boolean
  kill: () => void
}

interface StubSpec {
  exited: Promise<number>
  stdout?: string
  stderr?: string
}

function installSpawn(...specs: StubSpec[]): StubProc[] {
  calls = []
  procs = specs.map((spec) => {
    const proc: StubProc = {
      exited: spec.exited,
      stdout: new Response(spec.stdout ?? "").body,
      stderr: new Response(spec.stderr ?? "").body,
      killed: false,
      kill: () => {
        proc.killed = true
      },
    }
    return proc
  })

  let index = 0
  Bun.spawn = ((argv: string[]) => {
    calls.push(argv)
    const proc = procs[Math.min(index, procs.length - 1)]
    index += 1
    return proc
  }) as unknown as typeof Bun.spawn

  return procs
}

function hangingExited(): Promise<number> {
  return new Promise<number>(() => {})
}

beforeEach(() => {
  resetTmuxPathCache()
})

afterEach(() => {
  Bun.spawn = originalSpawn
  calls = []
  procs = []
})

describe("getPaneDimensions probe timeout", () => {
  test("returns null within the timeout when the display probe hangs, and kills it", async () => {
    //#given a resolving tmux path probe and a display probe that never settles
    const [whichProc, displayProc] = installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: hangingExited() },
    )

    //#when measuring the pane
    const started = Date.now()
    const result = await getPaneDimensions("pane")
    const elapsed = Date.now() - started

    //#then the measurement reports unknown within the timeout and kills the child
    expect(result).toBeNull()
    expect(displayProc.killed).toBe(true)
    expect(whichProc.killed).toBe(false)
    expect(elapsed).toBeLessThan(TMUX_PROBE_TIMEOUT_MS + 1_000)
  }, 10_000)

  test("negative: a normal exit still parses dimensions", async () => {
    //#given a healthy path probe and a display probe reporting sizes
    installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: Promise.resolve(0), stdout: "120,200\n" },
    )

    //#when measuring the pane
    const result = await getPaneDimensions("pane")

    //#then the parsed dimensions are returned
    expect(result).toEqual({ paneWidth: 120, windowWidth: 200 })
    expect(calls[2]).toEqual([
      "/usr/bin/tmux",
      "display",
      "-p",
      "-t",
      "pane",
      "#{pane_width},#{window_width}",
    ])
  })

  test("returns null on a non-zero display exit", async () => {
    //#given a display probe that exits non-zero
    installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: Promise.resolve(1) },
    )

    //#when measuring the pane
    const result = await getPaneDimensions("pane")

    //#then the existing failure value is returned
    expect(result).toBeNull()
  })

  test("returns null when stdout is not numeric", async () => {
    //#given a display probe with unparseable output
    installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: Promise.resolve(0), stdout: "not-a-size\n" },
    )

    //#when measuring the pane
    const result = await getPaneDimensions("pane")

    //#then the existing failure value is returned
    expect(result).toBeNull()
  })
})
