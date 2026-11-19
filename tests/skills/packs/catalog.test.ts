import { describe, expect, test } from "bun:test"
import {
  CORE_PACK_ID,
  PACK_CATALOG,
  PACK_CATALOG_BY_ID,
  PACK_PACKAGE_NAME,
  PACK_PACKAGE_VERSION,
  type InstalledPackSkill,
  type PackCatalogEntry,
  type PackId,
  type PackLock,
  type PackRisk,
  type PackSkillLock,
} from "../../../src/skills/packs"

const EXPECTED_PACK_IDS: PackId[] = [
  "ui-ux-pro-max",
  "design-system",
  "brand",
  "slides",
  "banner-design",
  "ui-styling",
  "design",
]

const EXPECTED_RISKS: Record<PackId, PackRisk[]> = {
  "ui-ux-pro-max": ["requiresPython"],
  "design-system": ["requiresNode"],
  brand: ["requiresNode"],
  slides: [],
  "banner-design": [],
  "ui-styling": ["requiresNode", "requiresNetwork"],
  design: ["requiresApiKeys", "requiresNetwork", "requiresPython"],
}

const REFS_ONLY_PACK_IDS: PackId[] = ["slides", "banner-design"]

describe("skill pack catalog", () => {
  test("catalog holds exactly the seven expected packs", () => {
    //#given the static catalog
    const ids = PACK_CATALOG.map((entry) => entry.id)
    //#when compared against the plan roster
    //#then
    expect(ids.toSorted()).toEqual(EXPECTED_PACK_IDS.toSorted())
    expect(new Set(ids).size).toBe(7)
  })

  test("every entry points at its own skill directory", () => {
    //#given the catalog
    for (const entry of PACK_CATALOG) {
      //#when inspecting the pack skill roster
      //#then the pack id is its own skill id, which is the `skills/<id>/SKILL.md` location
      expect(entry.skills).toContain(entry.id)
      expect(PACK_CATALOG_BY_ID[entry.id]).toBe(entry)
    }
  })

  test("every entry carries package metadata and non-empty description", () => {
    //#given the catalog
    for (const entry of PACK_CATALOG) {
      //#when checking package metadata
      //#then
      expect(entry.packageName).toBe(PACK_PACKAGE_NAME)
      expect(entry.version).toBe(PACK_PACKAGE_VERSION)
      expect(PACK_PACKAGE_NAME).toBe("ui-ux-pro-max-cli")
      expect(PACK_PACKAGE_VERSION).toBe("2.15.0")
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.notes.length).toBeGreaterThan(0)
    }
  })

  test("risk flags match the plan roster per pack", () => {
    //#given the catalog
    //#when reading each entry's risk set
    //#then
    for (const entry of PACK_CATALOG) {
      expect(entry.risk).toEqual(EXPECTED_RISKS[entry.id])
    }
  })

  test("exactly one core pack is flagged", () => {
    //#given the catalog
    const cores = PACK_CATALOG.filter((entry) => entry.isCore === true)
    //#when filtering core packs
    //#then
    expect(cores).toHaveLength(1)
    expect(cores[0]?.id).toBe(CORE_PACK_ID)
    expect(CORE_PACK_ID).toBe("ui-ux-pro-max")
    expect(cores[0]?.risk).toContain("requiresPython")
  })

  test("refs-only packs carry no scripts and no risk flags", () => {
    //#given the refs-only roster
    for (const id of REFS_ONLY_PACK_IDS) {
      //#when reading the entry
      const entry = PACK_CATALOG_BY_ID[id]
      //#then
      expect(entry.refsOnly).toBe(true)
      expect(entry.scripts).toEqual([])
      expect(entry.risk).toEqual([])
    }
  })

  test("ui-styling requires Node 18+ and network but bundles no fonts", () => {
    //#given the ui-styling entry
    const entry = PACK_CATALOG_BY_ID["ui-styling"]
    //#when inspecting runtime requirements
    //#then
    expect(entry.nodeMin).toBe("18")
    expect(entry.risk).toContain("requiresNode")
    expect(entry.risk).toContain("requiresNetwork")
    expect(entry.domains).not.toContain("fonts")
    expect(entry.notes.toLowerCase()).toContain("fonts are not bundled")
  })
})

describe("skill pack types", () => {
  test("InstalledPackSkill extends a builtin skill with pack provenance", () => {
    //#given a pack-resolved skill
    const skill: InstalledPackSkill = {
      name: "ui-ux-pro-max",
      description: "Core design intelligence",
      template: "# ui-ux-pro-max",
      packId: "ui-ux-pro-max",
      packRoot: "/packs/ui-ux-pro-max/2.15.0",
      skillRoot: "/packs/ui-ux-pro-max/2.15.0/skills/ui-ux-pro-max",
      risk: ["requiresPython"],
      source: "pack",
    }
    //#when reading provenance
    //#then
    expect(skill.source).toBe("pack")
    expect(skill.packId).toBe("ui-ux-pro-max")
    expect(skill.risk).toEqual(["requiresPython"])
    expect(skill.template).toContain("ui-ux-pro-max")
  })

  test("PackLock models the installed pack lockfile", () => {
    //#given an installed pack record
    const skillLock: PackSkillLock = {
      name: "ui-ux-pro-max",
      skillRoot: "skills/ui-ux-pro-max",
      files: ["SKILL.md"],
    }
    const lock: PackLock = {
      packId: "ui-ux-pro-max",
      version: "2.15.0",
      integrity: "sha512-deadbeef",
      sourceUrl: "https://registry.npmjs.org/ui-ux-pro-max-cli/-/ui-ux-pro-max-cli-2.15.0.tgz",
      installedAt: "2026-11-19T00:00:00.000Z",
      files: ["skills/ui-ux-pro-max/SKILL.md"],
      skills: [skillLock],
      risks: ["requiresPython"],
      pythonRequired: true,
    }
    //#when reading the lockfile record
    //#then
    expect(lock.packId).toBe("ui-ux-pro-max")
    expect(lock.files).toContain("skills/ui-ux-pro-max/SKILL.md")
    expect(lock.skills[0]?.name).toBe("ui-ux-pro-max")
    expect(lock.pythonRequired).toBe(true)
    expect(lock.risks).toContain("requiresPython")
  })

  test("catalog entries are structurally complete", () => {
    //#given a catalog entry shape
    const entry: PackCatalogEntry = PACK_CATALOG_BY_ID["design-system"]
    //#when inspecting arrays
    //#then
    expect(Array.isArray(entry.skills)).toBe(true)
    expect(Array.isArray(entry.domains)).toBe(true)
    expect(Array.isArray(entry.scripts)).toBe(true)
    expect(Array.isArray(entry.risk)).toBe(true)
  })
})
