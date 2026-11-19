/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { z } from "zod"
import {
  UIUX_DEFAULT_MAX_RESULTS,
  UIUX_MAX_STDOUT_BYTES,
  UIUX_TIMEOUT_MS,
} from "../../../src/tools/uiux/constants"
import { createUiuxTools, runUiuxSearch } from "../../../src/tools/uiux/tools"
import type { SpawnFn, SpawnResult, UiuxToolDeps } from "../../../src/tools/uiux/types"
import type { MatrixxToolContext, MatrixxToolResult } from "../../../src/shared/tool/define-tool"

const CORE_ROOT = "/packs/ui-ux-pro-max"
const PYTHON_BIN = "/usr/bin/python3"
const SEARCH_SCRIPT = join(CORE_ROOT, "scripts", "search.py")

interface SpawnCall {
  argv: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

function spawnReturning(result: SpawnResult) {
  const calls: SpawnCall[] = []
  const spawn: SpawnFn = async (argv, options) => {
    calls.push({ argv, ...options })
    return result
  }
  return { spawn, calls }
}

function depsWith(spawn: SpawnFn, overrides: Partial<UiuxToolDeps> = {}): UiuxToolDeps {
  return {
    coreSkillRoot: CORE_ROOT,
    pythonBin: PYTHON_BIN,
    timeoutMs: UIUX_TIMEOUT_MS,
    maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    spawn,
    ...overrides,
  }
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

function structured(result: MatrixxToolResult): { output?: unknown; metadata?: Record<string, unknown> } {
  if (typeof result === "string") {
    throw new Error(`expected a structured tool result, got ${result}`)
  }
  return result
}

describe("createUiuxTools", () => {
  test("exposes uiux_search with a teaching description", () => {
    //#given a successful spawn seam
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when building the uiux tool record
    const tools = createUiuxTools(depsWith(spawn))
    //#then every uiux tool is exported and search teaches intent
    expect(Object.keys(tools)).toEqual([
      "uiux_search",
      "uiux_design_system",
      "uiux_validate",
    ])
    const description = tools.uiux_search?.description ?? ""
    expect(description.length).toBeGreaterThan(80)
    expect(description).toContain("one dominant intent")
  })

  test("applies the default maxResults at the schema boundary", () => {
    //#given the uiux_search args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when parsing a query without maxResults
    const parsed = z.object(tools.uiux_search?.args ?? {}).parse({ query: "dashboard onboarding" })
    //#then the upstream default of three results is injected
    expect(parsed.maxResults).toBe(UIUX_DEFAULT_MAX_RESULTS)
  })

  test("rejects an unknown domain", () => {
    //#given the uiux_search args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when a domain outside the upstream choices is supplied
    const outcome = z
      .object(tools.uiux_search?.args ?? {})
      .safeParse({ query: "landing page", domain: "not-a-domain" })
    //#then Zod rejects it before any subprocess can run
    expect(outcome.success).toBe(false)
  })

  test("rejects an unknown stack", () => {
    //#given the uiux_search args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when a stack outside the upstream choices is supplied
    const outcome = z
      .object(tools.uiux_search?.args ?? {})
      .safeParse({ query: "sidebar", stack: "not-a-stack" })
    //#then Zod rejects it before any subprocess can run
    expect(outcome.success).toBe(false)
  })

  test("bounds maxResults to the upstream 1-20 range", () => {
    //#given the uiux_search args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const schema = z.object(createUiuxTools(depsWith(spawn)).uiux_search?.args ?? {})
    //#when values outside the argparse choices are supplied
    const tooSmall = schema.safeParse({ query: "colors", maxResults: 0 })
    const tooLarge = schema.safeParse({ query: "colors", maxResults: 21 })
    const upperBound = schema.safeParse({ query: "colors", maxResults: 20 })
    //#then only the inclusive 1-20 range passes
    expect(tooSmall.success).toBe(false)
    expect(tooLarge.success).toBe(false)
    expect(upperBound.success).toBe(true)
  })

  test("rejects an empty query", () => {
    //#given the uiux_search args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const schema = z.object(createUiuxTools(depsWith(spawn)).uiux_search?.args ?? {})
    //#when the query is empty
    const outcome = schema.safeParse({ query: "" })
    //#then Zod rejects it
    expect(outcome.success).toBe(false)
  })
})

describe("runUiuxSearch", () => {
  test("runs search.py from the pack root with the query and default result count", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "### Result 1\n", stderr: "" })
    //#when searching with only a query
    const result = await runUiuxSearch(depsWith(spawn), { query: "dense dashboard" })
    //#then the exact argv targets the pack script and the result is returned
    expect(result).toEqual({ ok: true, output: "### Result 1\n", truncated: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "dense dashboard",
      "--max-results",
      String(UIUX_DEFAULT_MAX_RESULTS),
    ])
    expect(calls[0]?.cwd).toBe(CORE_ROOT)
    expect(calls[0]?.timeoutMs).toBe(UIUX_TIMEOUT_MS)
    expect(calls[0]?.env.PYTHONIOENCODING).toBe("utf-8")
  })

  test("combines domain, stack and output flags in argv order", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "{}", stderr: "" })
    //#when every optional flag is set
    await runUiuxSearch(depsWith(spawn), {
      query: "onboarding wizard",
      domain: "style",
      stack: "nextjs",
      maxResults: 8,
      full: true,
      json: true,
    })
    //#then the long flags follow the query in their documented order
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "onboarding wizard",
      "--domain",
      "style",
      "--stack",
      "nextjs",
      "--max-results",
      "8",
      "--full",
      "--json",
    ])
  })

  test("keeps the query as a single argv element without shell interpolation", async () => {
    //#given a query containing shell metacharacters
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const query = 'a"; rm -rf /; echo "`whoami` $(id)'
    //#when searching
    await runUiuxSearch(depsWith(spawn), { query })
    //#then the query stays one untouched argv entry
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      query,
      "--max-results",
      String(UIUX_DEFAULT_MAX_RESULTS),
    ])
  })

  test("caps oversized text output and flags truncation", async () => {
    //#given a 10 byte stdout cap and a larger payload
    const { spawn } = spawnReturning({ code: 0, stdout: "x".repeat(60), stderr: "" })
    //#when searching
    const result = await runUiuxSearch(depsWith(spawn, { maxStdoutBytes: 10 }), {
      query: "typography pairings",
    })
    //#then the output is cut and flagged
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.output).toBe("xxxxxxxxxx\n[truncated: output exceeded 10 bytes]")
  })

  test("treats truncated JSON as an error so callers never parse partial JSON", async () => {
    //#given JSON output larger than the stdout cap
    const { spawn } = spawnReturning({ code: 0, stdout: '{"rows":["x","x","x"]}', stderr: "" })
    //#when searching with json enabled under a small cap
    const result = await runUiuxSearch(depsWith(spawn, { maxStdoutBytes: 10 }), {
      query: "color palette",
      json: true,
    })
    //#then the run is reported as truncated instead of returning partial JSON
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("truncated")
    expect(result.message).toContain("truncated")
  })

  test("passes a non-zero exit through as data", async () => {
    //#given a script that fails
    const { spawn } = spawnReturning({ code: 2, stdout: "", stderr: "Traceback: boom\n" })
    //#when searching
    const result = await runUiuxSearch(depsWith(spawn), { query: "icons" })
    //#then the failure carries the exit code and stderr detail
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("nonzero_exit")
    expect(result.detail).toContain("Traceback: boom")
  })

  test("never throws when the spawn seam rejects", async () => {
    //#given a spawn seam that rejects
    const spawn: SpawnFn = async () => {
      throw new Error("ENOENT")
    }
    //#when searching
    const result = await runUiuxSearch(depsWith(spawn), { query: "ux heuristics" })
    //#then the rejection becomes a spawn_failed result
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("spawn_failed")
    expect(result.detail).toContain("ENOENT")
  })

  test("returns a timeout error when the script exceeds the limit", async () => {
    //#given a spawn seam that timed out
    const { spawn } = spawnReturning({ code: null, stdout: "", stderr: "", timedOut: true })
    //#when searching
    const result = await runUiuxSearch(depsWith(spawn), { query: "charts" })
    //#then the timeout is reported as data
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("timeout")
  })
})

describe("uiux_search tool execute", () => {
  test("returns the script stdout as tool output", async () => {
    //#given a successful spawn seam
    const { spawn } = spawnReturning({ code: 0, stdout: "### Result 1\nPick a 4/8 spacing scale.\n", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when executing uiux_search
    const result = structured(
      await tools.uiux_search?.execute(
        { query: "spacing scale", maxResults: UIUX_DEFAULT_MAX_RESULTS },
        toolContext(),
      ),
    )
    //#then the raw stdout is surfaced and truncation is reported in metadata
    expect(result.output).toContain("4/8 spacing scale")
    expect(result.metadata?.truncated).toBe(false)
  })

  test("returns a machine-readable error payload on failure", async () => {
    //#given a script that fails
    const { spawn } = spawnReturning({ code: 1, stdout: "usage: search.py\n", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when executing uiux_search
    const result = structured(
      await tools.uiux_search?.execute(
        { query: "google fonts", maxResults: UIUX_DEFAULT_MAX_RESULTS },
        toolContext(),
      ),
    )
    //#then callers receive the error code and message as JSON
    const payload = JSON.parse(String(result.output)) as { ok: boolean; error: string }
    expect(payload.ok).toBe(false)
    expect(payload.error).toBe("nonzero_exit")
    expect(result.metadata?.error).toBe("nonzero_exit")
  })
})
