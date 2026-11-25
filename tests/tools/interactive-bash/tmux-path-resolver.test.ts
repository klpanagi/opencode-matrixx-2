import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TMUX_PROBE_TIMEOUT_MS } from "../../../src/shared/tmux/constants"
import {
  getTmuxPath,
  resetTmuxPathCache,
} from "../../../src/tools/interactive-bash/tmux-path-resolver"

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
})

describe("getTmuxPath probe timeouts", () => {
  test("returns null within the timeout when `which tmux` hangs, and kills it", async () => {
    //#given a `which tmux` probe whose exited promise never settles
    const [whichProc] = installSpawn({ exited: hangingExited() })

    //#when resolving the tmux path
    const startedAt = Date.now()
    const result = await Promise.race([
      getTmuxPath(),
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 2_500),
      ),
    ])

    //#then the call gives up, reports the existing failure value, and kills the child
    expect(result).toBeNull()
    expect(whichProc.killed).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(TMUX_PROBE_TIMEOUT_MS + 500)
  })

  test("returns null within the timeout when `tmux -V` hangs, and kills it", async () => {
    //#given a resolved path but a verification probe that never settles
    const [, verifyProc] = installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: hangingExited() },
    )

    //#when resolving the tmux path
    const startedAt = Date.now()
    const result = await Promise.race([
      getTmuxPath(),
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 2_500),
      ),
    ])

    //#then both probes ran, the verification was killed, and the path is rejected
    expect(calls[0]).toEqual([
      process.platform === "win32" ? "where" : "which",
      "tmux",
    ])
    expect(calls[1]).toEqual(["/usr/bin/tmux", "-V"])
    expect(result).toBeNull()
    expect(verifyProc.killed).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(TMUX_PROBE_TIMEOUT_MS + 500)
  })

  test("negative: healthy probes resolve the tmux path", async () => {
    //#given both probes exit successfully
    installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: Promise.resolve(0), stdout: "tmux 3.4\n" },
    )

    //#when resolving the tmux path
    const result = await getTmuxPath()

    //#then the verified path is returned
    expect(result).toBe("/usr/bin/tmux")
  })

  test("a timed-out probe is not cached as a permanent failure", async () => {
    //#given a first attempt that times out
    installSpawn({ exited: hangingExited() })
    expect(await getTmuxPath()).toBeNull()

    //#when the next call probes with a healthy spawn
    installSpawn(
      { exited: Promise.resolve(0), stdout: "/usr/bin/tmux\n" },
      { exited: Promise.resolve(0), stdout: "tmux 3.4\n" },
    )
    const result = await getTmuxPath()

    //#then the retry succeeds without a process restart
    expect(result).toBe("/usr/bin/tmux")
  })
})
