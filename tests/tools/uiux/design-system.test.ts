/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { z } from "zod"
import { UIUX_MAX_STDOUT_BYTES, UIUX_TIMEOUT_MS } from "../../../src/tools/uiux/constants"
import { createUiuxTools, runUiuxDesignSystem } from "../../../src/tools/uiux/tools"
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

function toolContext(directory = "/tmp/project"): MatrixxToolContext {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "mouse",
    directory,
    worktree: directory,
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

/** Mirrors the persistence report `search.py` prints on a successful persist. */
function persistedStdout(outputDir: string, slug: string, files: string[] = []): string {
  const designSystemDir = join(outputDir, "design-system", slug)
  const listed = files.length > 0 ? files : [join(designSystemDir, "MASTER.md")]
  return [
    "# Design System: Acme Portal",
    "",
    "=".repeat(60),
    `✅ Design system persisted to ${designSystemDir}/`,
    ...listed.map((file) => `   📄 ${file}`),
    "",
    `📖 Usage: When building a page, check ${designSystemDir}/pages/[page].md first.`,
    "=".repeat(60),
    "",
  ].join("\n")
}

describe("runUiuxDesignSystem", () => {
  test("builds the persist argv with the output directory", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({
      code: 0,
      stdout: persistedStdout("/tmp/project", "acme-portal"),
      stderr: "",
    })
    //#when generating a design system with persistence enabled by default
    await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
    })
    //#then the upstream design-system flags are passed in the documented order
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "Acme Portal",
      "--design-system",
      "--project-name",
      "Acme Portal",
      "--format",
      "markdown",
      "--persist",
      "--output-dir",
      "/tmp/project",
    ])
  })

  test("passes an explicit ascii format through", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "ok", stderr: "" })
    //#when requesting the ascii rendering without persistence
    await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      format: "ascii",
      persist: false,
    })
    //#then the format flag carries the requested value
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "Acme Portal",
      "--design-system",
      "--project-name",
      "Acme Portal",
      "--format",
      "ascii",
    ])
  })

  test("omits persist, page and force when persist is false", async () => {
    //#given a spawn seam and persistence disabled
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "ok", stderr: "" })
    //#when page and force are also supplied
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      persist: false,
      outputDir: "/tmp/project",
      page: "dashboard",
      force: true,
    })
    //#then no persistence-only flags reach the script
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "Acme Portal",
      "--design-system",
      "--project-name",
      "Acme Portal",
      "--format",
      "markdown",
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.persisted).toBeUndefined()
  })

  test("places page and force after the persist flags", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "ok", stderr: "" })
    //#when persisting a page override with force
    await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
      page: "dashboard",
      force: true,
    })
    //#then the optional flags follow the output directory
    expect(calls[0]?.argv).toEqual([
      PYTHON_BIN,
      SEARCH_SCRIPT,
      "Acme Portal",
      "--design-system",
      "--project-name",
      "Acme Portal",
      "--format",
      "markdown",
      "--persist",
      "--output-dir",
      "/tmp/project",
      "--page",
      "dashboard",
      "--force",
    ])
  })

  test("returns the absolute paths reported by the script", async () => {
    //#given a persist report that lists a master and a page file
    const master = "/tmp/project/design-system/acme-portal/MASTER.md"
    const page = "/tmp/project/design-system/acme-portal/pages/dashboard.md"
    const { spawn } = spawnReturning({
      code: 0,
      stdout: persistedStdout("/tmp/project", "acme-portal", [master, page]),
      stderr: "",
    })
    //#when the design system is persisted
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
      page: "dashboard",
    })
    //#then the reported file paths are surfaced verbatim
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.persisted).toEqual([master, page])
  })

  test("derives MASTER.md when the script confirms persistence without listing files", async () => {
    //#given a persist report whose file list is missing
    const { spawn } = spawnReturning({
      code: 0,
      stdout: "✅ Design system persisted to /tmp/project/design-system/acme-portal/\n",
      stderr: "",
    })
    //#when persisting a project whose name needs slugging
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal!",
      outputDir: "/tmp/project",
    })
    //#then MASTER.md is derived from the output directory and slug
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.persisted).toEqual([
      "/tmp/project/design-system/acme-portal/MASTER.md",
    ])
  })

  test("returns no persisted paths when persistence was skipped", async () => {
    //#given a report showing an existing MASTER.md was left untouched
    const { spawn } = spawnReturning({
      code: 0,
      stdout:
        "⚠️  /tmp/project/design-system/acme-portal/MASTER.md already exists and was not modified.\n",
      stderr: "",
    })
    //#when persisting without force
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
    })
    //#then the run succeeds but claims no created files
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.persisted).toBeUndefined()
  })

  test("surfaces a non-zero exit as data instead of throwing", async () => {
    //#given a script that fails
    const { spawn } = spawnReturning({
      code: 2,
      stdout: "",
      stderr: "usage: search.py\n",
    })
    //#when generating a design system
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
    })
    //#then the failure carries the shared error code and stderr detail
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("nonzero_exit")
    expect(result.detail).toContain("usage: search.py")
  })

  test("never throws when the spawn seam rejects", async () => {
    //#given a spawn seam that rejects
    const spawn: SpawnFn = async () => {
      throw new Error("ENOENT")
    }
    //#when generating a design system
    const result = await runUiuxDesignSystem(depsWith(spawn), {
      project: "Acme Portal",
      outputDir: "/tmp/project",
    })
    //#then the rejection becomes a spawn_failed result
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("spawn_failed")
    expect(result.detail).toContain("ENOENT")
  })
})

describe("uiux_design_system tool", () => {
  test("exposes both uiux tools and teaches the persistence contract", () => {
    //#given a successful spawn seam
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    //#when building the uiux tool record
    const tools = createUiuxTools(depsWith(spawn))
    //#then the search and design-system tools keep their contract and validate is added
    expect(Object.keys(tools)).toEqual([
      "uiux_search",
      "uiux_design_system",
      "uiux_validate",
    ])
    const description = tools.uiux_design_system?.description ?? ""
    expect(description).toContain("design system")
    expect(description).toContain("MASTER.md")
    expect(description).toContain("force")
  })

  test("defaults outputDir to the execution context directory", async () => {
    //#given a successful persist report
    const { spawn, calls } = spawnReturning({
      code: 0,
      stdout: persistedStdout("/tmp/project", "acme-portal"),
      stderr: "",
    })
    const tools = createUiuxTools(depsWith(spawn))
    //#when executing without an output directory
    const result = structured(
      await tools.uiux_design_system?.execute({ project: "Acme Portal" }, toolContext()),
    )
    //#then the context directory is passed as the persist directory
    expect(calls[0]?.argv).toContain("--output-dir")
    expect(calls[0]?.argv[calls[0].argv.indexOf("--output-dir") + 1]).toBe("/tmp/project")
    expect(result.metadata?.persisted).toEqual([
      "/tmp/project/design-system/acme-portal/MASTER.md",
    ])
  })

  test("resolves a relative outputDir against the context directory", async () => {
    //#given a successful spawn seam
    const { spawn, calls } = spawnReturning({ code: 0, stdout: "ok", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when executing with a relative output directory
    await tools.uiux_design_system?.execute(
      { project: "Acme Portal", outputDir: "apps/site" },
      toolContext("/tmp/project"),
    )
    //#then the script receives an absolute output directory
    const outputDirIndex = calls[0]?.argv.indexOf("--output-dir") ?? -1
    expect(outputDirIndex).toBeGreaterThan(-1)
    expect(calls[0]?.argv[outputDirIndex + 1]).toBe("/tmp/project/apps/site")
  })

  test("returns a machine-readable error payload on non-zero exit", async () => {
    //#given a script that refuses the run
    const { spawn } = spawnReturning({ code: 1, stdout: "", stderr: "boom\n" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when executing the design-system tool
    const result = structured(
      await tools.uiux_design_system?.execute({ project: "Acme Portal" }, toolContext()),
    )
    //#then callers receive the error code and message as JSON
    const payload = JSON.parse(String(result.output)) as { ok: boolean; error: string }
    expect(payload.ok).toBe(false)
    expect(payload.error).toBe("nonzero_exit")
    expect(result.metadata?.error).toBe("nonzero_exit")
  })
})

describe("uiux_design_system args schema", () => {
  test("applies the format and persist defaults at the schema boundary", () => {
    //#given the uiux_design_system args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    //#when parsing a project without optional fields
    const parsed = z
      .object(tools.uiux_design_system?.args ?? {})
      .parse({ project: "Acme Portal" })
    //#then markdown output and persistence are on by default
    expect(parsed.format).toBe("markdown")
    expect(parsed.persist).toBe(true)
  })

  test("rejects an empty project and an unknown format", () => {
    //#given the uiux_design_system args schema
    const { spawn } = spawnReturning({ code: 0, stdout: "", stderr: "" })
    const tools = createUiuxTools(depsWith(spawn))
    const schema = z.object(tools.uiux_design_system?.args ?? {})
    //#when the project is empty or the format is unsupported
    const emptyProject = schema.safeParse({ project: "" })
    const badFormat = schema.safeParse({ project: "Acme Portal", format: "html" })
    //#then Zod rejects both before any subprocess can run
    expect(emptyProject.success).toBe(false)
    expect(badFormat.success).toBe(false)
  })
})
