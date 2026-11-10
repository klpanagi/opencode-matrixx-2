import { describe, test, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AGENTS_FILENAME,
  migrateAgentsToFile,
  writeAgentsFile,
  writeMatrixxConfig,
} from "../../../src/cli/setup/config-writer"
import type { MatrixxConfig } from "../../../src/config/schema/matrixx-config"

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "agents-writer-"))
}

describe("writeAgentsFile", () => {
  test("creates sibling with both sections", () => {
    //#given a config path and agents content
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")

    //#when written
    const agentsPath = writeAgentsFile(
      configPath,
      { agents: { oracle: { model: "p/m" } }, categories: { source: { model: "p/c" } } },
      { dryRun: false, backup: false },
    )

    //#then sibling exists with both sections
    expect(agentsPath).toBe(join(dir, AGENTS_FILENAME))
    expect(existsSync(agentsPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(agentsPath, "utf-8"))
    expect(parsed.agents.oracle.model).toBe("p/m")
    expect(parsed.categories.source.model).toBe("p/c")
    rmSync(dir, { recursive: true, force: true })
  })

  test("dry-run writes nothing", () => {
    //#given a config path
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, "{}")

    //#when dry-run written
    const agentsPath = writeAgentsFile(
      configPath,
      { agents: { oracle: { model: "p/m" } } },
      { dryRun: true, backup: false },
    )

    //#then nothing written
    expect(existsSync(agentsPath)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("migrateAgentsToFile", () => {
  test("migrates both sections and removes inline keys", () => {
    //#given a main config with inline agents + categories
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: { oracle: { model: "p/m" } },
        categories: { source: { model: "p/c" } },
      }),
    )

    //#when migrated
    const result = migrateAgentsToFile(configPath, { dryRun: false, backup: true })

    //#then migrated with pointer set and inline keys deleted
    expect(result.migrated).toBe(true)
    expect(result.agentsPath).toBe(join(dir, AGENTS_FILENAME))
    const sibling = JSON.parse(readFileSync(result.agentsPath as string, "utf-8"))
    expect(sibling.agents.oracle.model).toBe("p/m")
    expect(sibling.categories.source.model).toBe("p/c")
    const main = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(main.agents).toBeUndefined()
    expect(main.categories).toBeUndefined()
    expect(main.agents_file).toBe(AGENTS_FILENAME)
    const hasBak = readdirSync(dir).some((f) => f.startsWith("matrixx.jsonc.bak."))
    expect(hasBak).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("no-op when neither inline section set", () => {
    //#given a main config with no inline sections
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(configPath, JSON.stringify({ tasks: { enabled: true } }))

    //#when migrated
    const result = migrateAgentsToFile(configPath, { dryRun: false, backup: false })

    //#then nothing migrated and no sibling written
    expect(result.migrated).toBe(false)
    expect(existsSync(join(dir, AGENTS_FILENAME))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("dry-run mutates nothing", () => {
    //#given inline sections present
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    const before = JSON.stringify({ agents: { oracle: { model: "p/m" } } })
    writeFileSync(configPath, before)

    //#when dry-run migrated
    const result = migrateAgentsToFile(configPath, { dryRun: true, backup: false })

    //#then main config untouched and no sibling written
    expect(result.migrated).toBe(true)
    expect(readFileSync(configPath, "utf-8")).toBe(before)
    expect(existsSync(join(dir, AGENTS_FILENAME))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("existing agents_file pointer preserved", () => {
    //#given a main config with an existing pointer
    const dir = makeDir()
    const configPath = join(dir, "matrixx.jsonc")
    writeFileSync(
      configPath,
      JSON.stringify({ agents_file: "shared.jsonc", agents: { oracle: { model: "p/m" } } }),
    )

    //#when migrated
    const result = migrateAgentsToFile(configPath, { dryRun: false, backup: false })

    //#then the pointer is kept
    expect(result.migrated).toBe(true)
    const main = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(main.agents_file).toBe("shared.jsonc")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("writeMatrixxConfig agents side-effect", () => {
  test("writes sibling when config has agents entries", async () => {
    //#given a target path and config with agents
    const dir = makeDir()
    const targetPath = join(dir, "matrixx.jsonc")
    const config = {
      tasks: { enabled: true },
      agents: { oracle: { model: "p/m" } },
    } as unknown as MatrixxConfig

    //#when written
    await writeMatrixxConfig(targetPath, config, { dryRun: false, backup: false })

    //#then sibling side-effect fired
    expect(existsSync(join(dir, AGENTS_FILENAME))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("no sibling when config has no agents or categories", async () => {
    //#given a config without agents/categories
    const dir = makeDir()
    const targetPath = join(dir, "matrixx.jsonc")
    const config = { tasks: { enabled: true } } as unknown as MatrixxConfig

    //#when written
    await writeMatrixxConfig(targetPath, config, { dryRun: false, backup: false })

    //#then no sibling side-effect
    expect(existsSync(join(dir, AGENTS_FILENAME))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
