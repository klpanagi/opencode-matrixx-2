import { describe, expect, mock, test } from "bun:test"
import type { MatrixxConfig } from "../../../src/config"
import { createRtkBashRewriterHook } from "../../../src/hooks/rtk-bash-rewriter/hook"

function streamFromString(str: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(str)); c.close() } })
}
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(c) { c.close() } })
}
function spawnMock(exitCode: number, stdout: string) {
  return mock(() => ({ exited: Promise.resolve(exitCode), stdout: streamFromString(stdout), stderr: emptyStream() })) as any
}
describe("createRtkBashRewriterHook", () => {
  test("returns passthrough hook when config.rtk.enabled is false", () => {
    //#given
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: false } } as MatrixxConfig)
    //#then
    expect(hook).toBeDefined()
    expect(hook["tool.execute.before"]).toBeDefined()
  })
  test("logs warning when rtk binary not found", () => {
    //#given
    const originalWhich = Bun.which; Bun.which = (() => null) as any
    const config = { rtk: { enabled: true } } as MatrixxConfig
    //#when
    const hook = createRtkBashRewriterHook({} as any, config)
    //#then
    expect(hook).toBeDefined()
    Bun.which = originalWhich
  })
  test("passes through when rtk binary not found", async () => {
    //#given
    const originalWhich = Bun.which; Bun.which = (() => null) as any
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git status")
    Bun.which = originalWhich
  })
  test("rewrites command when rtk returns exit code 0", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "rtk git status")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("rtk git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through when rtk returns exit code 1", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(1, "")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "echo hello" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("echo hello")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through when rtk returns exit code 2 (deny)", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(2, "")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "rm -rf /" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("rm -rf /")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("rewrites command when rtk returns exit code 3 (rewrite available)", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(3, "rtk git push")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git push" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("rtk git push")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through on subprocess timeout", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(3, "")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git push" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git push")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through on subprocess timeout", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any
    Bun.spawn = mock(() => ({ exited: Promise.reject(new Error("timeout")), stdout: emptyStream(), stderr: emptyStream() })) as any
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through on subprocess spawn error", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any
    Bun.spawn = mock(() => { throw new Error("spawn failed") }) as any
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("does not intercept interactive-bash tool", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "rtk git status")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "interactive-bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("does not intercept non-bash tools", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "rtk git status")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "write", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("passes through when command is empty", async () => {
    //#given
    const originalWhich = Bun.which; Bun.which = (() => "/usr/bin/rtk") as any
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("")
    Bun.which = originalWhich
  })
  test("passes through when rewritten command equals original", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "echo hello")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "echo hello" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("echo hello")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
  test("end-to-end with nonInteractiveEnv", async () => {
    //#given
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "rtk git status")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "bash", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when
    await hook["tool.execute.before"](input, output)
    //#then
    expect(output.args.command).toBe("rtk git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
})

describe("createRtkBashRewriterHook shell alias (V2)", () => {
  test("rewrites shell tool commands like bash", async () => {
    //#given: rtk binary present with a successful rewrite
    const originalWhich = Bun.which; const originalSpawn = Bun.spawn
    Bun.which = (() => "/usr/bin/rtk") as any; Bun.spawn = spawnMock(0, "rtk git status")
    const config = { rtk: { enabled: true } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config)
    const input = { tool: "shell", sessionID: "test", callID: "1" }
    const output = { args: { command: "git status" } }
    //#when: the shell tool runs
    await hook["tool.execute.before"](input, output)
    //#then: the command is rewritten
    expect(output.args.command).toBe("rtk git status")
    Bun.which = originalWhich; Bun.spawn = originalSpawn
  })
})

// T6 (P3a) — spawn avoidance via a cached capability probe + passthrough registry.
type RtkCapability = "rewrite" | "passthrough" | "unknown"

interface FakeRtkProcess {
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

function fakeProcess(exitCode: number, stdout: string): FakeRtkProcess {
  return { exited: Promise.resolve(exitCode), stdout: streamFromString(stdout), stderr: emptyStream() }
}

function countingSpawn(handler: (command: string) => { exitCode: number; stdout: string }) {
  const commands: string[] = []
  const spawn = (cmd: string[]): FakeRtkProcess => {
    const command = cmd[2] ?? ""
    commands.push(command)
    const result = handler(command)
    return fakeProcess(result.exitCode, result.stdout)
  }
  return { commands, spawn }
}

function rtkDeps(options: {
  capability: RtkCapability
  spawn: (cmd: string[]) => FakeRtkProcess
  which?: (binary: string) => string | null
  onProbe?: (binary: string) => void
}) {
  return {
    which: options.which ?? (() => "/usr/bin/rtk"),
    probe: (binary: string) => {
      options.onProbe?.(binary)
      return options.capability
    },
    spawn: options.spawn,
  }
}

function shellCall(command: string, tool = "bash") {
  return {
    input: { tool, sessionID: "test", callID: "1" },
    output: { args: { command } },
  }
}

describe("createRtkBashRewriterHook spawn avoidance (T6)", () => {
  test("capability=rewrite skips spawn for a simple ignored-class command", async () => {
    //#given: rtk supports rewrite, and the command class is in rtk's ignore list
    const spy = countingSpawn(() => ({ exitCode: 3, stdout: "rtk echo hello" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("echo hello")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then: no subprocess, command untouched
    expect(spy.commands).toHaveLength(0)
    expect(call.output.args.command).toBe("echo hello")
  })

  test("capability=rewrite still spawns and rewrites an eligible command", async () => {
    //#given: an eligible command class
    const spy = countingSpawn(() => ({ exitCode: 3, stdout: "rtk git status" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then: rewrite path unchanged
    expect(spy.commands).toEqual(["git status"])
    expect(call.output.args.command).toBe("rtk git status")
  })

  test("capability=rewrite does not skip compound commands that embed an eligible segment", async () => {
    //#given: a compound command starting with an ignored class
    const spy = countingSpawn(() => ({ exitCode: 3, stdout: "echo hi && rtk git status" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("echo hi && git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then: rtk still gets a chance to rewrite the second segment
    expect(spy.commands).toEqual(["echo hi && git status"])
    expect(call.output.args.command).toBe("echo hi && rtk git status")
  })

  test.each([
    "echo hi > /tmp/out",
    "echo \"quoted\"",
    "echo $(pwd)",
    "FOO=1 echo hi",
    "echo hi | cat",
  ])("capability=rewrite does not skip commands with shell constructs: %s", async (command) => {
    //#given: constructs that may hide an eligible segment or change tokenization
    const spy = countingSpawn(() => ({ exitCode: 1, stdout: "" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall(command)

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then: conservative fallback keeps the existing spawn behavior
    expect(spy.commands).toEqual([command])
    expect(call.output.args.command).toBe(command)
  })

  test("capability=passthrough skips every spawn (empty capability registry)", async () => {
    //#given: the probe reports no usable rewrite registry
    const spy = countingSpawn(() => ({ exitCode: 3, stdout: "rtk git status" }))
    const deps = rtkDeps({ capability: "passthrough", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then: no subprocess, no mutation
    expect(spy.commands).toHaveLength(0)
    expect(call.output.args.command).toBe("git status")
  })

  test("capability=unknown preserves the legacy always-spawn behavior", async () => {
    //#given: an inconclusive probe
    const spy = countingSpawn(() => ({ exitCode: 1, stdout: "" }))
    const deps = rtkDeps({ capability: "unknown", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("echo hello")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(spy.commands).toEqual(["echo hello"])
    expect(call.output.args.command).toBe("echo hello")
  })

  test("probes the binary once per hook instance (cached)", async () => {
    //#given
    let probeCalls = 0
    const spy = countingSpawn(() => ({ exitCode: 1, stdout: "" }))
    const deps = rtkDeps({
      capability: "rewrite",
      spawn: spy.spawn,
      onProbe: () => {
        probeCalls++
      },
    })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)

    //#when
    const first = shellCall("echo a")
    await hook["tool.execute.before"](first.input, first.output)
    const second = shellCall("echo b")
    await hook["tool.execute.before"](second.input, second.output)

    //#then: one probe at creation, never per call
    expect(probeCalls).toBe(1)
    expect(spy.commands).toHaveLength(0)
  })

  test("does not probe when the binary is absent", async () => {
    //#given
    let probeCalls = 0
    const spy = countingSpawn(() => ({ exitCode: 1, stdout: "" }))
    const deps = rtkDeps({
      capability: "rewrite",
      spawn: spy.spawn,
      which: () => null,
      onProbe: () => {
        probeCalls++
      },
    })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(probeCalls).toBe(0)
    expect(spy.commands).toHaveLength(0)
    expect(call.output.args.command).toBe("git status")
  })

  test("capability=rewrite keeps deny exit code 2 as passthrough for eligible commands", async () => {
    //#given
    const spy = countingSpawn(() => ({ exitCode: 2, stdout: "" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(spy.commands).toEqual(["git status"])
    expect(call.output.args.command).toBe("git status")
  })

  test("capability=rewrite skips already-rtk commands without mutation", async () => {
    //#given
    const spy = countingSpawn(() => ({ exitCode: 3, stdout: "rtk git status" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("rtk git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(spy.commands).toHaveLength(0)
    expect(call.output.args.command).toBe("rtk git status")
  })

  test("capability=rewrite skips simple commands with path arguments", async () => {
    //#given
    const spy = countingSpawn(() => ({ exitCode: 1, stdout: "" }))
    const deps = rtkDeps({ capability: "rewrite", spawn: spy.spawn })
    const hook = createRtkBashRewriterHook({} as any, { rtk: { enabled: true } } as MatrixxConfig, deps as any)
    const call = shellCall("mkdir -p src/hooks/rtk-bash-rewriter")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(spy.commands).toHaveLength(0)
    expect(call.output.args.command).toBe("mkdir -p src/hooks/rtk-bash-rewriter")
  })

  test("capability=rewrite uses the configured binary path for probe and spawn", async () => {
    //#given
    const probed: string[] = []
    const spawned: string[][] = []
    const deps = rtkDeps({
      capability: "rewrite",
      which: () => "/opt/rtk/bin/rtk",
      onProbe: (binary) => {
        probed.push(binary)
      },
      spawn: (cmd) => {
        spawned.push(cmd)
        return fakeProcess(3, "rtk git status")
      },
    })
    const config = { rtk: { enabled: true, binary_path: "/opt/rtk/bin/rtk" } } as MatrixxConfig
    const hook = createRtkBashRewriterHook({} as any, config, deps as any)
    const call = shellCall("git status")

    //#when
    await hook["tool.execute.before"](call.input, call.output)

    //#then
    expect(probed).toEqual(["/opt/rtk/bin/rtk"])
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.[0]).toBe("/opt/rtk/bin/rtk")
  })
})
