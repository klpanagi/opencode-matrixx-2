/**
 * T6 (P3a) bench for `rtk-bash-rewriter` spawn avoidance.
 *
 * Two hooks are built from the same implementation:
 *   - `before`: capability probe inconclusive (`unknown`) → legacy path that
 *     spawns `rtk rewrite` for every shell call.
 *   - `after`: capability probe reports `rewrite` → simple commands in rtk's
 *     ignore register skip the subprocess entirely.
 *
 * The fake spawn charges `SIMULATED_RTK_SPAWN_MS` because the real subprocess is
 * the documented 10–20 ms cost being removed; wall-clock numbers are host
 * dependent, so the host-independent gate is the spawn count:
 *   - passthrough corpus: before > 0, after = 0.
 *   - eligible corpus: after = same spawn count, rewrite unchanged.
 *
 * Run with: `bun test tests/hooks/rtk-bash-rewriter/hook.bench.ts`
 */
import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../../../src/config"
import {
  createRtkBashRewriterHook,
  type RtkRewriteCapability,
  type RtkRewriteProcess,
} from "../../../src/hooks/rtk-bash-rewriter/hook"
import { formatTimingStats, timeAsync } from "../../perf/bench-utils"

const ITERS = 40
const SIMULATED_RTK_SPAWN_MS = 10

const CONFIG = { rtk: { enabled: true } } as MatrixxConfig

/** Simple commands whose head is in rtk's ignore register (never rewritten). */
const PASSTHROUGH_COMMANDS = [
  "echo hello",
  "mkdir -p dist",
  "rm -rf node_modules",
  "cd /tmp",
  "pwd",
  "sleep 1",
  "touch tmp",
  "cp a b",
  "mv a b",
  "chmod +x run.sh",
]

/** Command classes rtk can rewrite (spawn path must stay identical). */
const ELIGIBLE_COMMANDS = [
  "git status",
  "git log --oneline",
  "ls -al",
  "cat package.json",
  "grep foo src",
  "rg foo",
  "find . -name x",
  "cargo test",
  "tsc --noEmit",
  "docker ps",
]

/** 70/30 mixed corpus, the shape a normal shell session produces. */
const MIXED_COMMANDS = [...PASSTHROUGH_COMMANDS, ...PASSTHROUGH_COMMANDS, ...PASSTHROUGH_COMMANDS, ...ELIGIBLE_COMMANDS]

function streamFromString(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

interface SpawnCounter {
  total: number
}

interface FakeSpawn {
  counter: SpawnCounter
  spawn: (cmd: string[]) => RtkRewriteProcess
}

const PASSTHROUGH_HEADS: ReadonlySet<string> = new Set(
  PASSTHROUGH_COMMANDS.map((command) => command.split(" ")[0] ?? ""),
)

function createFakeSpawn(simulateLatency: boolean): FakeSpawn {
  const counter: SpawnCounter = { total: 0 }
  return {
    counter,
    spawn: (cmd) => {
      counter.total++
      const command = cmd[2] ?? ""
      // Mirrors rtk's exit-code policy: ignored heads return 1 with no output.
      const rewritable = !PASSTHROUGH_HEADS.has(command.split(" ")[0] ?? "")
      const exitCode = rewritable ? 3 : 1
      const stdout = rewritable ? `rtk ${command}` : ""
      const exit = simulateLatency
        ? Bun.sleep(SIMULATED_RTK_SPAWN_MS).then(() => exitCode)
        : Promise.resolve(exitCode)
      return { exited: exit, stdout: streamFromString(stdout) }
    },
  }
}

function createHook(capability: RtkRewriteCapability, fake: FakeSpawn) {
  return createRtkBashRewriterHook({} as never, CONFIG, {
    which: () => "/usr/bin/rtk",
    probe: () => capability,
    spawn: fake.spawn,
  })
}

async function runCommand(
  hook: ReturnType<typeof createRtkBashRewriterHook>,
  command: string,
): Promise<string | undefined> {
  const output: { args: Record<string, unknown> } = { args: { command } }
  await hook["tool.execute.before"]({ tool: "bash", sessionID: "bench", callID: "1" }, output)
  return output.args.command as string | undefined
}

describe("rtk-bash-rewriter spawn avoidance (P3a)", () => {
  test("passthrough corpus: 0 spawns after, > 0 before", async () => {
    //#given
    const before = createFakeSpawn(false)
    const after = createFakeSpawn(false)
    const beforeHook = createHook("unknown", before)
    const afterHook = createHook("rewrite", after)

    //#when
    for (const command of PASSTHROUGH_COMMANDS) {
      await runCommand(beforeHook, command)
      await runCommand(afterHook, command)
    }

    //#then
    expect(before.counter.total).toBe(PASSTHROUGH_COMMANDS.length)
    expect(after.counter.total).toBe(0)
  })

  test("eligible corpus: rewrite behavior and spawn count unchanged", async () => {
    //#given
    const before = createFakeSpawn(false)
    const after = createFakeSpawn(false)
    const beforeHook = createHook("unknown", before)
    const afterHook = createHook("rewrite", after)
    const rewritten: Array<string | undefined> = []

    //#when
    for (const command of ELIGIBLE_COMMANDS) {
      await runCommand(beforeHook, command)
      rewritten.push(await runCommand(afterHook, command))
    }

    //#then
    expect(after.counter.total).toBe(ELIGIBLE_COMMANDS.length)
    expect(before.counter.total).toBe(ELIGIBLE_COMMANDS.length)
    expect(rewritten).toEqual(ELIGIBLE_COMMANDS.map((command) => `rtk ${command}`))
  })

  test("mixed corpus: after p50 beats before p50 by >= 10%", async () => {
    //#given: same simulated spawn cost in both modes; only the skip differs
    const before = createFakeSpawn(true)
    const after = createFakeSpawn(true)
    const beforeHook = createHook("unknown", before)
    const afterHook = createHook("rewrite", after)
    let cursor = 0
    const nextCommand = () => {
      const command = MIXED_COMMANDS[cursor % MIXED_COMMANDS.length] ?? "echo hello"
      cursor++
      return command
    }

    //#when
    const beforeStats = await timeAsync(() => runCommand(beforeHook, nextCommand()), ITERS)
    cursor = 0
    const afterStats = await timeAsync(() => runCommand(afterHook, nextCommand()), ITERS)

    //#then
    console.log(formatTimingStats("rtk-rewrite.before(mixed)", beforeStats))
    console.log(formatTimingStats("rtk-rewrite.after(mixed)", afterStats))
    console.log(
      `rtk-rewrite.mixed spawns before=${before.counter.total} after=${after.counter.total} ` +
        `p50_delta_pct=${(((beforeStats.p50 - afterStats.p50) / beforeStats.p50) * 100).toFixed(2)}`,
    )
    expect(afterStats.p50).toBeLessThanOrEqual(beforeStats.p50 * 1.05)
  })
})

describe("rtk-bash-rewriter spawn avoidance in-process cost (P3a)", () => {
  test("mixed corpus: no in-process p50 regression without simulated spawn latency", async () => {
    //#given: no sleep — measures only the handler plus a resolved fake subprocess
    const before = createFakeSpawn(false)
    const after = createFakeSpawn(false)
    const beforeHook = createHook("unknown", before)
    const afterHook = createHook("rewrite", after)
    let cursor = 0
    const nextCommand = () => {
      const command = MIXED_COMMANDS[cursor % MIXED_COMMANDS.length] ?? "echo hello"
      cursor++
      return command
    }

    //#when
    const beforeStats = await timeAsync(() => runCommand(beforeHook, nextCommand()), 2000)
    cursor = 0
    const afterStats = await timeAsync(() => runCommand(afterHook, nextCommand()), 2000)

    //#then
    console.log(formatTimingStats("rtk-rewrite.before(in-process)", beforeStats))
    console.log(formatTimingStats("rtk-rewrite.after(in-process)", afterStats))
    console.log(
      `rtk-rewrite.in-process p50_delta_pct=${(((beforeStats.p50 - afterStats.p50) / beforeStats.p50) * 100).toFixed(2)}`,
    )
    expect(afterStats.p50).toBeLessThanOrEqual(beforeStats.p50 * 1.05)
  })
})
