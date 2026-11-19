/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { PACK_LOCK_FILENAME, writeLockAtomic } from "../../../src/skills/packs/store"
import type { PackLock } from "../../../src/skills/packs/types"
import { UIUX_MAX_STDOUT_BYTES, UIUX_TIMEOUT_MS } from "../../../src/tools/uiux/constants"
import type { PythonProbeResult } from "../../../src/tools/uiux/python"
import { createUiuxTools, runUiuxValidate } from "../../../src/tools/uiux/tools"
import type { SpawnFn, SpawnResult, UiuxToolDeps } from "../../../src/tools/uiux/types"
import type { MatrixxToolContext, MatrixxToolResult } from "../../../src/shared/tool/define-tool"

const PACK_ID = "ui-ux-pro-max"
const VERSION = "2.15.0"
const PYTHON_BIN = "/usr/bin/python3"
const VALIDATOR_SCRIPT = join("scripts", "validate_data.py")

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

interface PackFixture {
  versionDir: string
  coreSkillRoot: string
}

interface PackFixtureOptions {
  /** Files to write under the skill root, keyed by relative path. */
  files?: Record<string, string>
  /** Lock file entries; defaults to the files actually written. */
  lockFiles?: string[]
  /** Include the upstream data validator script. */
  withValidator?: boolean
  /** Skip writing a lock entirely. */
  withoutLock?: boolean
}

function makeLock(overrides: Partial<PackLock> = {}): PackLock {
  return {
    packId: PACK_ID,
    version: VERSION,
    integrity: "sha512-test",
    sourceUrl: "https://example.test/ui-ux-pro-max.tgz",
    installedAt: "2026-01-01T00:00:00.000Z",
    files: [],
    skills: [],
    risks: ["requiresPython"],
    pythonRequired: true,
    ...overrides,
  }
}

/** Creates a real installed pack layout under a temporary packs root. */
function createPack(options: PackFixtureOptions = {}): PackFixture {
  const root = mkdtempSync(join(tmpdir(), "uiux-validate-"))
  tempRoots.push(root)

  const versionDir = join(root, PACK_ID, VERSION)
  const coreSkillRoot = join(versionDir, "skills", PACK_ID)
  const files: Record<string, string> = {
    "SKILL.md": "---\nname: ui-ux-pro-max\n---\n",
    ...options.files,
  }
  if (options.withValidator === true) {
    files[VALIDATOR_SCRIPT] = "print('validated')\n"
  }

  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(coreSkillRoot, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  if (options.withoutLock !== true) {
    const lockFiles =
      options.lockFiles ??
      Object.keys(files).map((relativePath) => `skills/${PACK_ID}/${relativePath}`)
    writeLockAtomic(versionDir, makeLock({ files: lockFiles }))
  }

  return { versionDir, coreSkillRoot }
}

interface SpawnCall {
  argv: string[]
  cwd: string
  timeoutMs: number
}

function spawnReturning(result: SpawnResult | Error) {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = async (argv, options) => {
    calls.push({ argv, cwd: options.cwd, timeoutMs: options.timeoutMs })
    if (result instanceof Error) throw result
    return result
  }
  return { spawn, calls }
}

function depsWith(
  fixture: PackFixture,
  spawn: SpawnFn,
  overrides: Partial<UiuxToolDeps> = {},
): UiuxToolDeps {
  return {
    coreSkillRoot: fixture.coreSkillRoot,
    pythonBin: PYTHON_BIN,
    timeoutMs: UIUX_TIMEOUT_MS,
    maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    spawn,
    ...overrides,
  }
}

/** Healthy probe stub so no test touches the real interpreter. */
function probeOk(): PythonProbeResult {
  return { ok: true, version: "3.12.1" }
}

function toolContext(): MatrixxToolContext {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "mouse",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  }
}

function structured(result: MatrixxToolResult): {
  output?: unknown
  metadata?: Record<string, unknown>
} {
  if (typeof result === "string") {
    throw new Error(`expected a structured tool result, got ${result}`)
  }
  return result
}

function checkNamed(
  checks: ReadonlyArray<{ name: string; ok: boolean; skipped?: boolean; detail?: string }>,
  name: string,
) {
  return checks.find((check) => check.name === name)
}

describe("runUiuxValidate", () => {
  test("returns not_installed when the pack has no lock file", async () => {
    //#given an installed directory with no lock
    const fixture = createPack({ withoutLock: true })
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    let probeCalls = 0
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), {
      probe: () => {
        probeCalls += 1
        return probeOk()
      },
    })
    //#then the shared not_installed error is returned without probing anything
    expect(result).toEqual({
      ok: false,
      error: "not_installed",
      message: "The ui-ux-pro-max skill pack is not installed",
    })
    expect(calls).toHaveLength(0)
    expect(probeCalls).toBe(0)
  })

  test("reports a malformed lock as a failing lock check", async () => {
    //#given a lock file that is not valid JSON
    const fixture = createPack({ withoutLock: true })
    mkdirSync(fixture.versionDir, { recursive: true })
    writeFileSync(join(fixture.versionDir, PACK_LOCK_FILENAME), "{ not json", "utf-8")
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the failure is a check report, not not_installed
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const lockCheck = checkNamed(result.checks, "lock")
    expect(lockCheck?.ok).toBe(false)
    expect(lockCheck?.detail).toContain(PACK_LOCK_FILENAME)
    expect(checkNamed(result.checks, "files")?.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test("passes every check when lock, files, validator and python agree", async () => {
    //#given a complete pack whose lock matches the disk
    const fixture = createPack({ withValidator: true })
    const { spawn, calls } = spawnReturning({
      code: 0,
      stdout: "validated 120 rows\n",
      stderr: "",
    })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then every check runs and passes
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.checks.map((check) => check.name)).toEqual([
      "lock",
      "files",
      "validator",
      "validator_run",
      "python",
    ])
    expect(result.checks.every((check) => check.ok)).toBe(true)
    expect(result.python).toEqual({ ok: true, version: "3.12.1" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      join(fixture.coreSkillRoot, VALIDATOR_SCRIPT),
    ])
    expect(calls[0]?.cwd).toBe(fixture.coreSkillRoot)
  })

  test("fails the files check when the disk and lock counts disagree", async () => {
    //#given a lock that records fewer files than the disk holds
    const fixture = createPack({
      files: { "SKILL.md": "# skill\n", "scripts/extra.py": "print('extra')\n" },
      lockFiles: [`skills/${PACK_ID}/SKILL.md`],
    })
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the count mismatch fails the files check with both numbers
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const filesCheck = checkNamed(result.checks, "files")
    expect(filesCheck?.ok).toBe(false)
    expect(filesCheck?.detail).toContain("expected 1")
    expect(filesCheck?.detail).toContain("actual 2")
  })

  test("ignores Python bytecode and OS metadata when counting files", async () => {
    //#given a pack whose validator run left __pycache__, a stray .pyc and .DS_Store
    const fixture = createPack({
      files: {
        "SKILL.md": "# skill\n",
        "scripts/core.py": "print('core')\n",
        "scripts/__pycache__/core.cpython-312.pyc": "",
        "scripts/stray.pyo": "",
        ".DS_Store": "",
      },
      lockFiles: [`skills/${PACK_ID}/SKILL.md`, `skills/${PACK_ID}/scripts/core.py`],
    })
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then bytecode and OS noise do not count against the lock manifest
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(checkNamed(result.checks, "files")).toEqual({
      name: "files",
      ok: true,
      detail: `lock.json agrees with 2 files on disk`,
    })
  })

  test("still fails when a locked file is missing from disk", async () => {
    //#given a lock that records a file the disk does not have
    const fixture = createPack({
      files: { "SKILL.md": "# skill\n" },
      lockFiles: [`skills/${PACK_ID}/SKILL.md`, `skills/${PACK_ID}/scripts/core.py`],
    })
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the genuinely missing file still fails the count check
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const filesCheck = checkNamed(result.checks, "files")
    expect(filesCheck?.ok).toBe(false)
    expect(filesCheck?.detail).toContain("expected 2")
    expect(filesCheck?.detail).toContain("actual 1")
  })

  test("skips the validator check when validate_data.py is absent", async () => {
    //#given a pack without the upstream data validator
    const fixture = createPack()
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the missing validator is a skipped check, not a failure
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(checkNamed(result.checks, "validator")).toEqual({
      name: "validator",
      ok: true,
      skipped: true,
      detail: "not present",
    })
    expect(checkNamed(result.checks, "validator_run")).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  test("reports a failing validator run with the stderr snippet", async () => {
    //#given a validator that exits non-zero
    const fixture = createPack({ withValidator: true })
    const { spawn } = spawnReturning({
      code: 1,
      stdout: "",
      stderr: "Traceback: boom\n",
    })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the shortened error becomes a failing validator_run check
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const runCheck = checkNamed(result.checks, "validator_run")
    expect(runCheck?.ok).toBe(false)
    expect(runCheck?.detail).toContain("exited with code 1")
    expect(runCheck?.detail).toContain("Traceback: boom")
  })

  test("never throws when the spawn seam rejects", async () => {
    //#given a spawn seam that rejects
    const fixture = createPack({ withValidator: true })
    const { spawn } = spawnReturning(new Error("ENOENT"))
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), { probe: probeOk })
    //#then the rejection is captured as a failing check
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const runCheck = checkNamed(result.checks, "validator_run")
    expect(runCheck?.ok).toBe(false)
    expect(runCheck?.detail).toContain("ENOENT")
  })

  test("reports a failing python probe as a check failure", async () => {
    //#given a probe that cannot find Python
    const fixture = createPack({ withValidator: true })
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), {
      probe: () => ({ ok: false, error: "No Python interpreter found." }),
    })
    //#then the python check fails while the pack checks still report
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    const pythonCheck = checkNamed(result.checks, "python")
    expect(pythonCheck?.ok).toBe(false)
    expect(pythonCheck?.detail).toContain("No Python interpreter found.")
  })

  test("never throws when the probe throws", async () => {
    //#given a probe that throws instead of returning
    const fixture = createPack()
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when validating the pack
    const result = await runUiuxValidate(depsWith(fixture, spawn), {
      probe: () => {
        throw new Error("probe exploded")
      },
    })
    //#then the thrown message is reported as a failing python check
    expect(result.ok).toBe(false)
    if ("error" in result) throw new Error("expected a check report")
    expect(checkNamed(result.checks, "python")?.detail).toContain("probe exploded")
  })
})

describe("uiux_validate tool", () => {
  test("exposes uiux_validate with a bounded teaching description", () => {
    //#given a successful spawn seam
    const fixture = createPack()
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when building the uiux tool record
    const tools = createUiuxTools(depsWith(fixture, spawn))
    //#then the validate tool is registered and teaches what it checks
    expect(Object.keys(tools)).toEqual([
      "uiux_search",
      "uiux_design_system",
      "uiux_validate",
    ])
    const description = tools.uiux_validate?.description ?? ""
    expect(description).toContain("lock")
    expect(description).toContain("validator")
    expect(description.length).toBeLessThan(600)
  })

  test("accepts no arguments at the schema boundary", () => {
    //#given the uiux_validate args schema
    const fixture = createPack()
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(fixture, spawn))
    //#when parsing an empty argument object
    const parsed = z.object(tools.uiux_validate?.args ?? {}).parse({})
    //#then the schema is an empty object
    expect(parsed).toEqual({})
  })

  test("returns the full report as a structured result", async () => {
    //#given a healthy pack
    const fixture = createPack({ withValidator: true })
    const { spawn } = spawnReturning({ code: 0, stdout: "ok\n", stderr: "" })
    const tools = createUiuxTools(depsWith(fixture, spawn))
    //#when executing the tool
    const result = structured(
      await tools.uiux_validate?.execute({}, toolContext()),
    )
    //#then the JSON report and metadata agree
    const payload = JSON.parse(String(result.output)) as {
      ok: boolean
      checks: Array<{ name: string }>
    }
    expect(payload.ok).toBe(true)
    expect(payload.checks.map((check) => check.name)).toContain("files")
    expect(result.metadata?.ok).toBe(true)
  })

  test("returns a machine-readable error payload for a missing pack", async () => {
    //#given a pack directory without a lock
    const fixture = createPack({ withoutLock: true })
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(fixture, spawn))
    //#when executing the tool
    const result = structured(
      await tools.uiux_validate?.execute({}, toolContext()),
    )
    //#then the not_installed code is exposed without throwing
    const payload = JSON.parse(String(result.output)) as { ok: boolean; error: string }
    expect(payload).toEqual({
      ok: false,
      error: "not_installed",
      message: "The ui-ux-pro-max skill pack is not installed",
    })
    expect(result.metadata?.error).toBe("not_installed")
  })
})
