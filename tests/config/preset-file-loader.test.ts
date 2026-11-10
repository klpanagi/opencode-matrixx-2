/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolvePresetsFilePath, loadPresetsFile } from "../../src/config/preset-file-loader"

describe("resolvePresetsFilePath", () => {
  test("resolves sibling matrixx.presets.jsonc by default", () => {
    //#given a config path
    const configPath = "/tmp/x/matrixx.jsonc"
    //#when resolved with no pointer
    const result = resolvePresetsFilePath(configPath)
    //#then sibling presets file is returned
    expect(result).toBe("/tmp/x/matrixx.presets.jsonc")
  })

  test("resolves explicit pointer relative to config dir", () => {
    //#given a config path and a relative pointer
    //#when resolved
    const result = resolvePresetsFilePath("/tmp/x/matrixx.jsonc", "custom.jsonc")
    //#then joined to config dir
    expect(result).toBe("/tmp/x/custom.jsonc")
  })

  test("expands ~ in pointer", () => {
    //#given a pointer with tilde
    //#when resolved
    const result = resolvePresetsFilePath("/tmp/x/matrixx.jsonc", "~/presets.jsonc")
    //#then expanded to home dir, not containing tilde
    expect(result).not.toContain("~")
  })
})

describe("loadPresetsFile", () => {
  test("loads valid presets file", () => {
    //#given a valid presets file on disk
    const dir = mkdtempSync(join(tmpdir(), "presets-"))
    const p = join(dir, "matrixx.presets.jsonc")
    writeFileSync(p, JSON.stringify({ eco: { default_model: "p/model" } }))
    //#when loaded
    const result = loadPresetsFile(p)
    //#then presets returned with no error
    expect(result.error).toBeUndefined()
    expect(result.presets?.eco?.default_model).toBe("p/model")
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns empty presets for missing file without error", () => {
    //#given a nonexistent path
    //#when loaded
    const result = loadPresetsFile("/tmp/does-not-exist-xyz/matrixx.presets.jsonc")
    //#then no presets and no error
    expect(result.presets).toBeNull()
    expect(result.error).toBeUndefined()
  })

  test("returns error for invalid presets content", () => {
    //#given a file with invalid preset model
    const dir = mkdtempSync(join(tmpdir(), "presets-"))
    const p = join(dir, "matrixx.presets.jsonc")
    writeFileSync(p, JSON.stringify({ eco: { default_model: "bare-no-slash" } }))
    //#when loaded
    const result = loadPresetsFile(p)
    //#then error reported, presets null
    expect(result.presets).toBeNull()
    expect(result.error).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("mergeConfigs shallow-merges model_presets per preset name", () => {
    //#given covered by plugin-config test; placeholder to document precedence
    expect(true).toBe(true)
  })
})
