/// <reference types="bun:test" />
import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxConfig } from "../src/config/schema/matrixx-config"
import { attachFileAgents, mergeConfigs } from "../src/plugin-config"
import { clearConfigLoadErrors, getConfigLoadErrors } from "../src/shared/config/config-errors"

beforeEach(() => {
  clearConfigLoadErrors()
})

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "agents-attach-"))
}

describe("attachFileAgents per-scope merge", () => {
  test("inline fields win, file-only fields kept", () => {
    //#given a config dir with sibling file + inline override
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")
    writeFileSync(
      join(dir, "matrixx.agents.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "p/file", skills: ["a"] } } }),
    )
    const config = {
      agents: { oracle: { skills: ["b"] } },
    } as unknown as MatrixxConfig

    //#when attached
    const result = attachFileAgents(config, configPath)

    //#then inline skills win, file model kept
    expect(result.agents?.oracle?.skills).toEqual(["b"])
    expect(result.agents?.oracle?.model).toBe("p/file")
    rmSync(dir, { recursive: true, force: true })
  })

  test("no sibling file and no pointer leaves config unchanged", () => {
    //#given a config with no file present
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")
    const config = { agents: { oracle: { model: "p/m" } } } as unknown as MatrixxConfig

    //#when attached
    const result = attachFileAgents(config, configPath)

    //#then unchanged and no errors recorded
    expect(result.agents?.oracle?.model).toBe("p/m")
    expect(getConfigLoadErrors()).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("malformed sibling degrades to inline-only with recorded error", () => {
    //#given a malformed sibling file
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")
    writeFileSync(join(dir, "matrixx.agents.jsonc"), "{ broken !!!")
    const config = { agents: { oracle: { model: "p/m" } } } as unknown as MatrixxConfig

    //#when attached
    const result = attachFileAgents(config, configPath)

    //#then inline still applied and error recorded
    expect(result.agents?.oracle?.model).toBe("p/m")
    expect(getConfigLoadErrors().length).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("explicit pointer resolves relative to config dir", () => {
    //#given a pointer to a custom filename
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")
    writeFileSync(
      join(dir, "custom.jsonc"),
      JSON.stringify({ categories: { source: { model: "p/c" } } }),
    )
    const config = { agents_file: "custom.jsonc" } as MatrixxConfig

    //#when attached
    const result = attachFileAgents(config, configPath)

    //#then categories loaded from the pointer target
    expect(result.categories?.source?.model).toBe("p/c")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("cross-scope agents merge via mergeConfigs", () => {
  test("project fields beat user fields, user-only fields survive", () => {
    //#given attached user and project configs
    const userDir = makeDir()
    const projectDir = makeDir()
    const userPath = join(userDir, "matrixx.jsonc")
    const projectPath = join(projectDir, "matrixx.jsonc")
    writeFileSync(userPath, "{}")
    writeFileSync(projectPath, "{}")
    writeFileSync(
      join(userDir, "matrixx.agents.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "p/user", skills: ["u"] } } }),
    )
    writeFileSync(
      join(projectDir, "matrixx.agents.jsonc"),
      JSON.stringify({ agents: { oracle: { skills: ["p"] } } }),
    )
    const userAttached = attachFileAgents({} as MatrixxConfig, userPath)
    const projectAttached = attachFileAgents(
      { agents: { oracle: { disabled: true } } } as unknown as MatrixxConfig,
      projectPath,
    )

    //#when merged cross-scope
    const result = mergeConfigs(userAttached, projectAttached)

    //#then project inline beats both files, user file survives where project silent
    expect(result.agents?.oracle?.model).toBe("p/user")
    expect(result.agents?.oracle?.skills).toEqual(["p"])
    expect(result.agents?.oracle?.disabled).toBe(true)
    rmSync(userDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })
})

describe("agents_file pointer carry", () => {
  test("project pointer wins with override spread semantics", () => {
    //#given both scopes set a pointer
    const base = { agents_file: "base.jsonc" } as MatrixxConfig
    const override = { agents_file: "override.jsonc" } as MatrixxConfig

    //#when merged
    //#then override wins, base survives when override silent
    expect(mergeConfigs(base, override).agents_file).toBe("override.jsonc")
    expect(mergeConfigs(base, {} as MatrixxConfig).agents_file).toBe("base.jsonc")
  })
})

describe("file-provided model resolution", () => {
  test("file-provided model lands on the merged entry", () => {
    //#given a config with no inline model but a file model
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")
    writeFileSync(
      join(dir, "matrixx.agents.jsonc"),
      JSON.stringify({ agents: { oracle: { model: "p/file" } } }),
    )

    //#when attached
    const result = attachFileAgents({} as MatrixxConfig, configPath)

    //#then the entry carries an explicit model
    expect(result.agents?.oracle?.model).toBe("p/file")
    rmSync(dir, { recursive: true, force: true })
  })
})
