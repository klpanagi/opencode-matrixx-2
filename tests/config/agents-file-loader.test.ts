/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_AGENTS_FILENAME,
  resolveAgentsFilePath,
  loadAgentsFile,
  mergeFileAndInlineAgents,
} from "../../src/config/agents-file-loader"

describe("resolveAgentsFilePath", () => {
  test("resolves default sibling filename", () => {
    //#given a config path
    const configPath = "/tmp/x/matrixx.jsonc"

    //#when resolved with no pointer
    const result = resolveAgentsFilePath(configPath)

    //#then default sibling returned
    expect(result).toBe(`/tmp/x/${DEFAULT_AGENTS_FILENAME}`)
  })

  test("resolves explicit pointer relative to config dir", () => {
    //#given a config path and a relative pointer
    //#when resolved
    const result = resolveAgentsFilePath("/tmp/x/matrixx.jsonc", "custom.jsonc")

    //#then joined to config dir
    expect(result).toBe("/tmp/x/custom.jsonc")
  })

  test("expands ~ in pointer", () => {
    //#given a pointer with tilde
    //#when resolved
    const result = resolveAgentsFilePath("/tmp/x/matrixx.jsonc", "~/agents.jsonc")

    //#then expanded to home dir, not containing tilde
    expect(result).not.toContain("~")
  })

  test("honors absolute pointer as-is", () => {
    //#given an absolute pointer
    //#when resolved
    const result = resolveAgentsFilePath("/tmp/x/matrixx.jsonc", "/abs/agents.jsonc")

    //#then returned unchanged
    expect(result).toBe("/abs/agents.jsonc")
  })

  test("falls back to .json sibling when .jsonc missing", () => {
    //#given a dir with only the .json sibling present
    const dir = mkdtempSync(join(tmpdir(), "agents-fallback-"))
    writeFileSync(join(dir, "matrixx.agents.json"), JSON.stringify({ agents: {} }))

    //#when resolved with no pointer
    const result = resolveAgentsFilePath(join(dir, "matrixx.jsonc"))

    //#then the .json sibling is returned
    expect(result).toBe(join(dir, "matrixx.agents.json"))
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("loadAgentsFile", () => {
  test("loads valid agents file", () => {
    //#given a valid agents file on disk
    const dir = mkdtempSync(join(tmpdir(), "agents-"))
    const p = join(dir, "matrixx.agents.jsonc")
    writeFileSync(
      p,
      JSON.stringify({ agents: { oracle: { model: "p/model" } } }),
    )

    //#when loaded
    const result = loadAgentsFile(p)

    //#then file returned with no error
    expect(result.error).toBeUndefined()
    expect(result.file?.agents?.oracle?.model).toBe("p/model")
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null file without error for missing file", () => {
    //#given a nonexistent path
    //#when loaded
    const result = loadAgentsFile("/tmp/does-not-exist-xyz/matrixx.agents.jsonc")

    //#then no file and no error
    expect(result.file).toBeNull()
    expect(result.error).toBeUndefined()
  })

  test("returns error for malformed JSONC without throwing", () => {
    //#given a file with invalid JSON
    const dir = mkdtempSync(join(tmpdir(), "agents-"))
    const p = join(dir, "matrixx.agents.jsonc")
    writeFileSync(p, "{ not valid jsonc !!!")

    //#when loaded
    const result = loadAgentsFile(p)

    //#then error reported, file null, no exception
    expect(result.file).toBeNull()
    expect(result.error).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns error for shape-invalid file", () => {
    //#given a file with wrong types
    const dir = mkdtempSync(join(tmpdir(), "agents-"))
    const p = join(dir, "matrixx.agents.jsonc")
    writeFileSync(p, JSON.stringify({ agents: { oracle: { steps: "many" } } }))

    //#when loaded
    const result = loadAgentsFile(p)

    //#then error reported, file null
    expect(result.file).toBeNull()
    expect(result.error).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("mergeFileAndInlineAgents", () => {
  test("returns undefined when all inputs absent", () => {
    //#given no file, no inline
    //#when merged
    const result = mergeFileAndInlineAgents(null, undefined, undefined)

    //#then undefined
    expect(result).toBeUndefined()
  })

  test("inline partial override keeps file fields (field-level merge)", () => {
    //#given file agents oracle with model + skills, inline oracle with skills only
    const file = {
      agents: { oracle: { model: "p/model", skills: ["a"] } },
      categories: undefined,
    }
    const inlineAgents = { oracle: { skills: ["b"] } }

    //#when merged
    const result = mergeFileAndInlineAgents(file, inlineAgents, undefined)

    //#then file model kept, skills array replaced
    expect(result?.agents?.oracle?.model).toBe("p/model")
    expect(result?.agents?.oracle?.skills).toEqual(["b"])
  })

  test("absent section leaves inline intact and never materializes empty objects", () => {
    //#given file with only categories, inline with only agents
    const file = { categories: { source: { model: "p/model" } } }
    const inlineAgents = { oracle: { model: "p/model" } }

    //#when merged
    const result = mergeFileAndInlineAgents(file, inlineAgents, undefined)

    //#then both sections present
    expect(result?.agents?.oracle?.model).toBe("p/model")
    expect(result?.categories?.source?.model).toBe("p/model")
  })
})
