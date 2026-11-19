import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildAvailableSkills } from "../../../src/agents/registry/available-skills"
import type { MatrixxConfig } from "../../../src/config"
import { resolveDiscoveredPackSkills } from "../../../src/plugin/handlers/agent-config-handler"
import { PACK_SKILL_FILENAME } from "../../../src/skills/packs/constants"
import { invalidatePackCache } from "../../../src/skills/packs/loader"
import { PACK_LOCK_FILENAME } from "../../../src/skills/packs/store"
import type { PackId, PackLock } from "../../../src/skills/packs/types"

const CORE_ID: PackId = "ui-ux-pro-max"
const ALPHA_ID: PackId = "design-system"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "matrixx-pack-skills-handler-"))
  invalidatePackCache()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  invalidatePackCache()
})

function makeLock(packId: PackId): PackLock {
  return {
    packId,
    version: "2.15.0",
    integrity: "sha512-deadbeef",
    sourceUrl: `https://example.test/${packId}.tgz`,
    installedAt: "2026-01-01T00:00:00.000Z",
    files: [],
    skills: [],
    risks: [],
    pythonRequired: false,
  }
}

function packConfig(skillPacks: Record<string, unknown>): MatrixxConfig {
  return { skill_packs: skillPacks } as MatrixxConfig
}

function installSkill(
  packId: PackId,
  dirName: string,
  frontmatter: { name: string; description: string } = {
    name: dirName,
    description: `${dirName} description`,
  }
): string {
  const versionDir = join(root, packId, "2.15.0")
  mkdirSync(versionDir, { recursive: true })
  writeFileSync(
    join(versionDir, PACK_LOCK_FILENAME),
    `${JSON.stringify(makeLock(packId), null, 2)}\n`
  )
  const skillDir = join(versionDir, "skills", dirName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, PACK_SKILL_FILENAME),
    [
      "---",
      `name: ${frontmatter.name}`,
      `description: ${frontmatter.description}`,
      "---",
      `# ${dirName}`,
      "",
      `Body for ${dirName}.`,
      "",
    ].join("\n")
  )
  return skillDir
}

describe("resolveDiscoveredPackSkills", () => {
  test("returns installed pack skills that reach buildAvailableSkills as plugin skills", () => {
    //#given
    installSkill(CORE_ID, CORE_ID, {
      name: CORE_ID,
      description: "Core design intelligence",
    })
    const config = packConfig({ root })

    //#when
    const discovered = resolveDiscoveredPackSkills(config)
    const available = buildAvailableSkills(discovered)

    //#then
    expect(discovered.map((skill) => skill.name)).toContain(CORE_ID)
    const entry = available.find((skill) => skill.name === CORE_ID)
    expect(entry).toBeDefined()
    expect(entry?.location).toBe("plugin")
    expect(entry?.description).toBe("Core design intelligence")
  })

  test("returns nothing when skill packs are disabled", () => {
    //#given
    installSkill(CORE_ID, CORE_ID)
    const config = packConfig({ enabled: false, root })

    //#when
    const discovered = resolveDiscoveredPackSkills(config)

    //#then
    expect(discovered).toEqual([])
    expect(buildAvailableSkills(discovered).some((skill) => skill.name === CORE_ID)).toBe(false)
  })

  test("returns nothing without throwing for an absent config block, missing root, or corrupt skill", () => {
    //#given
    const missingRoot = packConfig({ root: join(root, "missing") })
    installSkill(ALPHA_ID, "alpha-a")
    const corruptSkillDir = join(root, ALPHA_ID, "2.15.0", "skills", "alpha-b")
    mkdirSync(corruptSkillDir, { recursive: true })
    writeFileSync(join(corruptSkillDir, PACK_SKILL_FILENAME), "not a skill document")
    const corruptRoot = packConfig({ root })

    //#when
    const noConfig = resolveDiscoveredPackSkills({} as MatrixxConfig)
    const missing = resolveDiscoveredPackSkills(missingRoot)
    const corrupt = resolveDiscoveredPackSkills(corruptRoot)

    //#then
    expect(noConfig).toEqual([])
    expect(missing).toEqual([])
    expect(corrupt.map((skill) => skill.name)).toEqual(["alpha-a"])
  })

  test("forwards disabled packs and skills to the loader", () => {
    //#given
    installSkill(CORE_ID, CORE_ID)
    installSkill(ALPHA_ID, "alpha-a")
    const all = resolveDiscoveredPackSkills(packConfig({ root }))
    expect(all).toHaveLength(2)

    //#when
    const disabledPack = resolveDiscoveredPackSkills(
      packConfig({ root, disabled_packs: [ALPHA_ID] })
    )
    const disabledSkill = resolveDiscoveredPackSkills(
      packConfig({ root, disabled_skills: [CORE_ID] })
    )

    //#then
    expect(disabledPack.map((skill) => skill.name)).toEqual([CORE_ID])
    expect(disabledSkill.map((skill) => skill.name)).toEqual(["alpha-a"])
  })
})
