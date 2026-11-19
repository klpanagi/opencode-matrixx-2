/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  UIUX_DEFAULT_MAX_RESULTS,
  UIUX_DOMAINS,
  UIUX_MAX_STDOUT_BYTES,
  UIUX_STACKS,
  UIUX_TIMEOUT_MS,
} from "../../../src/tools/uiux/constants"
import { formatToolError, runPackScript } from "../../../src/tools/uiux/spawn"
import type { SpawnFn, SpawnResult, UiuxToolDeps } from "../../../src/tools/uiux/types"

interface SpawnCall {
  argv: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

function depsWith(spawn: SpawnFn, overrides: Partial<UiuxToolDeps> = {}): UiuxToolDeps {
  return {
    coreSkillRoot: "/packs/ui-ux-pro-max",
    pythonBin: "/usr/bin/python3",
    timeoutMs: UIUX_TIMEOUT_MS,
    maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    spawn,
    ...overrides,
  }
}

function spawnReturning(result: SpawnResult) {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = async (argv, opts) => {
    calls.push({ argv, ...opts })
    return result
  }
  return { spawn, calls }
}

describe("uiux constants", () => {
  test("exposes the verified pack defaults", () => {
    //#given the uiux constants module
    //#when reading the defaults
    //#then the values mirror the upstream search.py limits
    expect(UIUX_TIMEOUT_MS).toBe(12_000)
    expect(UIUX_MAX_STDOUT_BYTES).toBe(12_288)
    expect(UIUX_DEFAULT_MAX_RESULTS).toBe(3)
  })

  test("lists every upstream domain", () => {
    //#given the uiux constants module
    //#when reading the domain enum
    //#then it matches the script's argparse choices
    expect(UIUX_DOMAINS).toEqual([
      "style",
      "color",
      "chart",
      "landing",
      "product",
      "ux",
      "typography",
      "icons",
      "gsap",
      "react",
      "web",
      "google-fonts",
    ])
  })

  test("lists every upstream stack", () => {
    //#given the uiux constants module
    //#when reading the stack enum
    //#then it matches the script's argparse choices
    expect(UIUX_STACKS).toEqual([
      "react",
      "nextjs",
      "vue",
      "svelte",
      "astro",
      "swiftui",
      "react-native",
      "flutter",
      "nuxtjs",
      "nuxt-ui",
      "html-tailwind",
      "shadcn",
      "jetpack-compose",
      "threejs",
      "angular",
      "laravel",
      "javafx",
      "wpf",
      "winui",
      "avalonia",
      "uno",
      "uwp",
    ])
  })
})

describe("runPackScript", () => {
  test("runs the script from the pack root and returns stdout", async () => {
    //#given a spawn seam that succeeds
    const { spawn, calls } = spawnReturning({ code: 0, stdout: '{"ok":true}\n', stderr: "" })

    //#when running a pack script with args
    const result = await runPackScript(depsWith(spawn), {
      script: "scripts/search.py",
      args: ["--domain", "style", "--max-results", "3"],
    })

    //#then the interpreter, script and args are passed in order
    expect(result).toEqual({ ok: true, stdout: '{"ok":true}\n', truncated: false, code: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.argv).toEqual([
      "/usr/bin/python3",
      "scripts/search.py",
      "--domain",
      "style",
      "--max-results",
      "3",
    ])
  })

  test("runs with the pack root as cwd and the configured timeout", async () => {
    //#given a spawn seam that succeeds
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "[]", stderr: "" })

    //#when running a pack script under a custom timeout
    await runPackScript(depsWith(spawn, { timeoutMs: 500 }), { script: "search.py" })

    //#then cwd points at the pack root and the deps timeout is forwarded
    expect(calls[0]?.cwd).toBe("/packs/ui-ux-pro-max")
    expect(calls[0]?.timeoutMs).toBe(500)
  })

  test("forwards args-less scripts without extra argv entries", async () => {
    //#given a spawn seam that succeeds
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })

    //#when the request carries no args
    await runPackScript(depsWith(spawn), { script: "scripts/design_system.py" })

    //#then only interpreter and script are passed
    expect(calls[0]?.argv).toEqual(["/usr/bin/python3", "scripts/design_system.py"])
  })

  test("forces a UTF-8 environment while keeping base variables", async () => {
    //#given a spawn seam that succeeds
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })

    //#when running a pack script
    await runPackScript(depsWith(spawn), { script: "search.py" })

    //#then the python env is applied over process.env
    const env = calls[0]?.env ?? {}
    expect(env.PYTHONIOENCODING).toBe("utf-8")
    expect(env.PYTHONUTF8).toBe("1")
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH)
  })

  test("returns a nonzero_exit error carrying stderr as detail", async () => {
    //#given a spawn seam that exits non-zero
    const { spawn } = spawnReturning({ code: 2, stdout: "", stderr: "Traceback: boom\n" })

    //#when running a pack script
    const result = await runPackScript(depsWith(spawn), { script: "search.py" })

    //#then the failure is data, not a throw
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("nonzero_exit")
    expect(result.detail).toContain("Traceback: boom")
  })

  test("falls back to stdout when a failing script writes no stderr", async () => {
    //#given a spawn seam that exits non-zero with stdout only
    const { spawn } = spawnReturning({ code: 1, stdout: "usage: search.py\n", stderr: "" })

    //#when running a pack script
    const result = await runPackScript(depsWith(spawn), { script: "search.py" })

    //#then stdout becomes the detail
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("nonzero_exit")
    expect(result.detail).toContain("usage: search.py")
  })

  test("returns a timeout error when the spawn reports a timeout", async () => {
    //#given a spawn seam that timed out
    const { spawn } = spawnReturning({ code: null, stdout: "", stderr: "", timedOut: true })

    //#when running a pack script
    const result = await runPackScript(depsWith(spawn, { timeoutMs: 250 }), { script: "search.py" })

    //#then the timeout is reported with the configured limit
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("timeout")
    expect(result.message).toContain("250")
  })

  test("returns spawn_failed when the child dies without an exit code", async () => {
    //#given a spawn seam that reports a signal termination
    const { spawn } = spawnReturning({ code: null, stdout: "", stderr: "" })

    //#when running a pack script
    const result = await runPackScript(depsWith(spawn), { script: "search.py" })

    //#then the missing exit code is surfaced as a spawn failure
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("spawn_failed")
  })

  test("never throws when the spawn seam rejects", async () => {
    //#given a spawn seam that rejects
    const spawn: SpawnFn = async () => {
      throw new Error("ENOENT")
    }

    //#when running a pack script
    const result = await runPackScript(depsWith(spawn), { script: "search.py" })

    //#then the rejection becomes a spawn_failed result
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("spawn_failed")
    expect(result.detail).toContain("ENOENT")
  })

  test("truncates oversized stdout and appends a size marker", async () => {
    //#given stdout far above the configured cap
    const { spawn } = spawnReturning({ code: 0, stdout: "x".repeat(100), stderr: "" })

    //#when running with a 10 byte cap
    const result = await runPackScript(depsWith(spawn, { maxStdoutBytes: 10 }), {
      script: "search.py",
    })

    //#then the output is cut to the cap and flagged
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.stdout).toBe("xxxxxxxxxx\n[truncated: output exceeded 10 bytes]")
  })

  test("keeps stdout untouched when it fits the cap", async () => {
    //#given stdout exactly at the cap
    const { spawn } = spawnReturning({ code: 0, stdout: "x".repeat(10), stderr: "" })

    //#when running with a 10 byte cap
    const result = await runPackScript(depsWith(spawn, { maxStdoutBytes: 10 }), {
      script: "search.py",
    })

    //#then nothing is truncated or marked
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(false)
    expect(result.stdout).toBe("x".repeat(10))
  })

  test("never splits a multi-byte character when truncating", async () => {
    //#given UTF-8 output whose cap lands inside a multi-byte character
    const { spawn } = spawnReturning({ code: 0, stdout: "aé", stderr: "" })

    //#when running with a 2 byte cap
    const result = await runPackScript(depsWith(spawn, { maxStdoutBytes: 2 }), {
      script: "search.py",
    })

    //#then the partial character is dropped instead of producing a replacement
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stdout.startsWith("a")).toBe(true)
    expect(result.stdout).not.toContain("\uFFFD")
  })
})

describe("formatToolError", () => {
  test("builds a discriminated failure result", () => {
    //#given a failure code and message
    //#when formatting the tool error
    const result = formatToolError("not_installed", "ui-ux-pro-max pack is missing")

    //#then the shape is stable and machine-readable
    expect(result).toEqual({
      ok: false,
      error: "not_installed",
      message: "ui-ux-pro-max pack is missing",
    })
  })

  test("accepts every documented error code", () => {
    //#given the full set of tool error codes
    const codes = [
      "not_installed",
      "python_unavailable",
      "timeout",
      "spawn_failed",
      "nonzero_exit",
      "truncated",
    ] as const

    //#when formatting each of them
    //#then each round-trips its code
    for (const code of codes) {
      expect(formatToolError(code, code).error).toBe(code)
    }
  })
})

const posixOnly = test.skipIf(process.platform === "win32")

describe("runPackScript default spawn", () => {
  posixOnly("captures stdout from a real child process", async () => {
    //#given deps without an injected spawn seam
    const deps: UiuxToolDeps = {
      coreSkillRoot: process.cwd(),
      pythonBin: "/bin/echo",
      timeoutMs: UIUX_TIMEOUT_MS,
      maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    }

    //#when running the echo binary as the interpreter
    const result = await runPackScript(deps, { script: "pong" })

    //#then the default Bun.spawn implementation returns its output
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stdout.trim()).toBe("pong")
  })

  posixOnly("kills a hung child and reports a timeout", async () => {
    //#given a child that outlives the timeout
    const deps: UiuxToolDeps = {
      coreSkillRoot: process.cwd(),
      pythonBin: "/bin/sleep",
      timeoutMs: 100,
      maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    }

    //#when running it past the limit
    const result = await runPackScript(deps, { script: "5" })

    //#then the process is killed and the timeout is surfaced
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("timeout")
  })

  posixOnly("reports the exit code of a failing real child process", async () => {
    //#given a child that exits non-zero
    const deps: UiuxToolDeps = {
      coreSkillRoot: process.cwd(),
      pythonBin: "/bin/sh",
      timeoutMs: UIUX_TIMEOUT_MS,
      maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    }

    //#when running it
    const result = await runPackScript(deps, { script: "-c", args: ["exit 7"] })

    //#then the non-zero exit is reported as data
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("nonzero_exit")
    expect(result.message).toContain("7")
  })
})
