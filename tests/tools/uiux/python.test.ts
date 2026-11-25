/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test"
import {
  MAX_PYTHON_PROBE_CACHE,
  probePython,
  pythonEnv,
  resetPythonProbeCache,
  resolvePythonBin,
  type SpawnResult,
} from "../../../src/tools/uiux/python"

function whichFrom(available: string[]) {
  const calls: string[] = []
  const which = (bin: string) => {
    calls.push(bin)
    return available.includes(bin) ? `/usr/bin/${bin}` : undefined
  }
  return { which, calls }
}

function spawnReturning(stdout: string, exitCode = 0, stderr = "") {
  const calls: string[][] = []
  const spawnFn = (argv: string[]): SpawnResult => {
    calls.push(argv)
    return { exitCode, stdout, stderr }
  }
  return { spawnFn, calls }
}

beforeEach(() => {
  resetPythonProbeCache()
})

describe("resolvePythonBin", () => {
  test("uses the explicit python_bin without probing PATH", () => {
    //#given an explicit python_bin and a PATH that has python3
    const { which, calls } = whichFrom(["python3", "python"])

    //#when resolving on linux
    const resolved = resolvePythonBin(
      { python_bin: "/opt/py/bin/python3.12" },
      { platform: "linux", which },
    )

    //#then the explicit binary wins and nothing is looked up
    expect(resolved).toBe("/opt/py/bin/python3.12")
    expect(calls).toEqual([])
  })

  test("prefers python3 over python on non-win32 platforms", () => {
    //#given both python3 and python are on PATH
    const { which, calls } = whichFrom(["python3", "python"])

    //#when resolving on linux
    const resolved = resolvePythonBin({}, { platform: "linux", which })

    //#then python3 is chosen and python is never checked
    expect(resolved).toBe("/usr/bin/python3")
    expect(calls).toEqual(["python3"])
  })

  test("falls back to python when python3 is missing", () => {
    //#given only python is on PATH
    const { which, calls } = whichFrom(["python"])

    //#when resolving on darwin
    const resolved = resolvePythonBin({}, { platform: "darwin", which })

    //#then python is chosen after python3 misses
    expect(resolved).toBe("/usr/bin/python")
    expect(calls).toEqual(["python3", "python"])
  })

  test("uses the py launcher last on win32", () => {
    //#given only the py launcher is on PATH
    const { which, calls } = whichFrom(["py"])

    //#when resolving on win32
    const resolved = resolvePythonBin({}, { platform: "win32", which })

    //#then py is the last-best-effort candidate
    expect(resolved).toBe("/usr/bin/py")
    expect(calls).toEqual(["python3", "python", "py"])
  })

  test("does not consider py on non-win32 platforms", () => {
    //#given only the py launcher is on PATH on linux
    const { which, calls } = whichFrom(["py"])

    //#when resolving
    const resolved = resolvePythonBin({}, { platform: "linux", which })

    //#then nothing resolves and py is never queried
    expect(resolved).toBeUndefined()
    expect(calls).toEqual(["python3", "python"])
  })

  test("returns undefined when no candidate is available", () => {
    //#given an empty PATH
    const { which } = whichFrom([])

    //#when resolving on win32
    const resolved = resolvePythonBin({}, { platform: "win32", which })

    //#then no binary is returned
    expect(resolved).toBeUndefined()
  })

  test("treats a blank explicit python_bin as unset", () => {
    //#given an explicit python_bin of whitespace
    const { which } = whichFrom(["python3"])

    //#when resolving
    const resolved = resolvePythonBin({ python_bin: "   " }, { platform: "linux", which })

    //#then normal PATH resolution is used
    expect(resolved).toBe("/usr/bin/python3")
  })
})

describe("pythonEnv", () => {
  test("forces UTF-8 output mode", () => {
    //#given no base environment
    //#when building the python environment
    const env = pythonEnv()

    //#then both UTF-8 switches and the no-bytecode switch are present
    expect(env).toEqual({
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    })
  })

  test("preserves base variables and overrides their UTF-8 settings", () => {
    //#given a base env with a conflicting PYTHONUTF8 value and an undefined entry
    const base = { PATH: "/usr/bin", PYTHONUTF8: "0", DROPPED: undefined }

    //#when building the python environment
    const env = pythonEnv(base)

    //#then the base is carried over minus undefined, with UTF-8 and no-bytecode forced on
    expect(env).toEqual({
      PATH: "/usr/bin",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    })
  })

  test("forces PYTHONDONTWRITEBYTECODE even when the base env disables it", () => {
    //#given a base env that asks Python to write bytecode
    const base = { PYTHONDONTWRITEBYTECODE: "0" }
    //#when building the python environment
    const env = pythonEnv(base)
    //#then pack scripts can never mutate the installed pack
    expect(env.PYTHONDONTWRITEBYTECODE).toBe("1")
  })

  test("does not mutate the base environment", () => {
    //#given a base env
    const base = { PATH: "/usr/bin" }

    //#when building the python environment
    pythonEnv(base)

    //#then the caller's object is untouched
    expect(base).toEqual({ PATH: "/usr/bin" })
  })
})

describe("probePython", () => {
  test("parses the version from --version output", () => {
    //#given a python that prints its version to stdout
    const { spawnFn, calls } = spawnReturning("Python 3.11.14\n")

    //#when probing the binary
    const result = probePython("/usr/bin/python3", { spawnFn })

    //#then the semantic version is returned and --version is the only argument
    expect(result).toEqual({ ok: true, version: "3.11.14" })
    expect(calls).toEqual([["/usr/bin/python3", "--version"]])
  })

  test("memoises the probe per binary", () => {
    //#given a successful probe
    const { spawnFn, calls } = spawnReturning("Python 3.12.1\n")

    //#when probing the same binary twice
    const first = probePython("/usr/bin/python3", { spawnFn })
    const second = probePython("/usr/bin/python3", { spawnFn })

    //#then the spawn happens once and both calls agree
    expect(first).toEqual({ ok: true, version: "3.12.1" })
    expect(second).toEqual(first)
    expect(calls.length).toBe(1)
  })

  test("reports a failure when the binary exits non-zero", () => {
    //#given a python that fails
    const { spawnFn } = spawnReturning("", 1, "command not found")

    //#when probing
    const result = probePython("/usr/bin/missing-python", { spawnFn })

    //#then the probe fails with an actionable error
    expect(result.ok).toBe(false)
    expect(result.version).toBeUndefined()
    expect(result.error).toContain("command not found")
  })

  test("reports a failure when the version cannot be parsed", () => {
    //#given output that carries no Python version
    const { spawnFn } = spawnReturning("something else\n")

    //#when probing
    const result = probePython("/usr/bin/python3", { spawnFn })

    //#then the probe fails instead of guessing
    expect(result.ok).toBe(false)
    expect(result.version).toBeUndefined()
    expect(result.error).toBeDefined()
  })

  test("fails without spawning when no binary is resolved", () => {
    //#given no resolved python binary
    const { spawnFn, calls } = spawnReturning("Python 3.11.14\n")

    //#when probing undefined
    const result = probePython(undefined, { spawnFn })

    //#then it fails fast and never spawns
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(calls).toEqual([])
  })

  test("never throws when the spawn seam throws", () => {
    //#given a spawn that explodes
    const spawnFn = (): SpawnResult => {
      throw new Error("boom")
    }

    //#when probing
    const result = probePython("/usr/bin/python3", { spawnFn })

    //#then the failure is returned as data
    expect(result.ok).toBe(false)
    expect(result.error).toContain("boom")
  })

  test("passes -3 to the win32 py launcher", () => {
    //#given the py launcher
    const { spawnFn, calls } = spawnReturning("Python 3.13.0\n")

    //#when probing the launcher
    const result = probePython("py", { spawnFn })

    //#then py is invoked with -3 to select Python 3
    expect(result).toEqual({ ok: true, version: "3.13.0" })
    expect(calls).toEqual([["py", "-3", "--version"]])
  })

  test("resetPythonProbeCache clears memoised results", () => {
    //#given a memoised probe
    const { spawnFn, calls } = spawnReturning("Python 3.11.0\n")
    probePython("/usr/bin/python3", { spawnFn })
    expect(calls.length).toBe(1)

    //#when the cache is reset and the binary probed again
    resetPythonProbeCache()
    probePython("/usr/bin/python3", { spawnFn })

    //#then the probe runs a second time
    expect(calls.length).toBe(2)
  })
})

describe("probePython cache bound", () => {
  test("caps at MAX_PYTHON_PROBE_CACHE and evicts oldest-first when probing 5000 binaries", () => {
    //#given a fresh cache and a counting spawn seam
    resetPythonProbeCache()
    const { spawnFn, calls } = spawnReturning("Python 3.11.14\n")
    const callsFor = (bin: string) => calls.filter((argv) => argv[0] === bin).length

    //#when the oldest binary is probed and then 5000 binaries fill the cache
    probePython("/bin/py-0", { spawnFn })
    for (let i = 1; i < 5000; i++) {
      probePython(`/bin/py-${i}`, { spawnFn })
    }

    //#then the entries inside the last MAX window stay memoised
    const boundaryBin = `/bin/py-${5000 - MAX_PYTHON_PROBE_CACHE}`
    probePython(boundaryBin, { spawnFn })
    probePython(boundaryBin, { spawnFn })
    expect(callsFor(boundaryBin)).toBe(1)

    const recentBin = "/bin/py-4999"
    probePython(recentBin, { spawnFn })
    probePython(recentBin, { spawnFn })
    expect(callsFor(recentBin)).toBe(1)

    //#and the oldest entry was evicted and is re-probed
    probePython("/bin/py-0", { spawnFn })
    expect(callsFor("/bin/py-0")).toBe(2)
  })
})
