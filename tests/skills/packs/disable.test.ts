/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { resolvePackDisables } from "../../../src/skills/packs"

interface DiscoveredSkill {
  name: string
  packId: string
}

function collectWarnings(): { warnings: string[]; onWarn: (msg: string) => void } {
  const warnings: string[] = []
  return { warnings, onWarn: (msg) => warnings.push(msg) }
}

describe("resolvePackDisables", () => {
  test("returns empty sets when the config is undefined", () => {
    //#given no skill_packs config at all
    //#when resolving disables
    const result = resolvePackDisables(undefined)
    //#then both sets are empty and the call never throws
    expect(result.disabledPacks).toBeInstanceOf(Set)
    expect(result.disabledSkills).toBeInstanceOf(Set)
    expect(result.disabledPacks.size).toBe(0)
    expect(result.disabledSkills.size).toBe(0)
  })

  test("returns empty sets when the disable lists are absent", () => {
    //#given a config that enables packs but disables nothing
    //#when resolving disables
    const result = resolvePackDisables({ enabled: true })
    //#then
    expect(result.disabledPacks.size).toBe(0)
    expect(result.disabledSkills.size).toBe(0)
  })

  test("keeps catalog pack ids listed in disabled_packs", () => {
    //#given a known pack from the static catalog
    //#when resolving disables
    const result = resolvePackDisables({ disabled_packs: ["brand"] })
    //#then the pack is kept in the disabled set
    expect(result.disabledPacks).toEqual(new Set(["brand"]))
  })

  test("keeps discovered pack ids that are not in the catalog", () => {
    //#given an installed pack absent from the static catalog
    const discovered: DiscoveredSkill[] = [{ name: "custom", packId: "custom-pack" }]
    //#when resolving disables
    const result = resolvePackDisables({ disabled_packs: ["custom-pack"] }, discovered)
    //#then the discovered pack is accepted
    expect(result.disabledPacks).toEqual(new Set(["custom-pack"]))
  })

  test("warns once for an unknown pack and ignores it", () => {
    //#given a disabled pack that is neither catalogued nor discovered, listed twice
    const { warnings, onWarn } = collectWarnings()
    //#when resolving disables
    const result = resolvePackDisables({ disabled_packs: ["ghost", "ghost"] }, [], onWarn)
    //#then the unknown name is ignored and only one warning is emitted
    expect(result.disabledPacks.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("ghost")
  })

  test("keeps catalog skill names listed in disabled_skills", () => {
    //#given a skill name shipped by the catalog
    //#when resolving disables without a discovered list
    const result = resolvePackDisables({ disabled_skills: ["brand"] })
    //#then the catalog roster is enough to accept it
    expect(result.disabledSkills).toEqual(new Set(["brand"]))
  })

  test("normalizes pack/skill identifiers to the skill name", () => {
    //#given a pack-scoped skill identifier
    //#when resolving disables
    const result = resolvePackDisables({ disabled_skills: ["ui-ux-pro-max/ui-ux-pro-max"] })
    //#then the loader-facing skill name is returned
    expect(result.disabledSkills).toEqual(new Set(["ui-ux-pro-max"]))
  })

  test("keeps discovered skill names that are not in the catalog", () => {
    //#given a skill discovered from an installed pack
    const discovered: DiscoveredSkill[] = [{ name: "custom-skill", packId: "design" }]
    //#when resolving disables
    const result = resolvePackDisables(
      { disabled_skills: ["design/custom-skill"] },
      discovered
    )
    //#then the discovered skill is accepted under its bare name
    expect(result.disabledSkills).toEqual(new Set(["custom-skill"]))
  })

  test("warns once for an unknown skill and ignores it", () => {
    //#given an unknown skill listed twice
    const { warnings, onWarn } = collectWarnings()
    //#when resolving disables
    const result = resolvePackDisables({ disabled_skills: ["ghost", "brand/ghost"] }, [], onWarn)
    //#then both forms collapse to the same unknown name and warn only once
    expect(result.disabledSkills.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("ghost")
  })

  test("pack-level disables win over skill entries", () => {
    //#given a disabled pack and a skill entry that belongs to it
    const { warnings, onWarn } = collectWarnings()
    //#when resolving disables
    const result = resolvePackDisables(
      { disabled_packs: ["brand"], disabled_skills: ["brand/ghost"] },
      [],
      onWarn
    )
    //#then the pack is disabled, the redundant skill is dropped, and nothing warns
    expect(result.disabledPacks).toEqual(new Set(["brand"]))
    expect(result.disabledSkills.size).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  test("pack-level disables win for discovered skills", () => {
    //#given a discovered pack that is disabled and its skill listed separately
    const discovered: DiscoveredSkill[] = [{ name: "custom-skill", packId: "brand" }]
    const { warnings, onWarn } = collectWarnings()
    //#when resolving disables
    const result = resolvePackDisables(
      { disabled_packs: ["brand"], disabled_skills: ["custom-skill"] },
      discovered,
      onWarn
    )
    //#then the pack set alone governs and the skill is not repeated
    expect(result.disabledPacks).toEqual(new Set(["brand"]))
    expect(result.disabledSkills.size).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  test("uses a no-op warning sink by default", () => {
    //#given unknown names but no onWarn callback
    //#when resolving disables
    const result = resolvePackDisables(
      { disabled_packs: ["ghost-pack"], disabled_skills: ["ghost-skill"] }
    )
    //#then the call does not throw and the unknown names are ignored
    expect(result.disabledPacks.size).toBe(0)
    expect(result.disabledSkills.size).toBe(0)
  })

  test("does not throw on empty or malformed entries", () => {
    //#given blank and separator-only identifiers
    const { warnings, onWarn } = collectWarnings()
    //#when resolving disables
    const result = resolvePackDisables(
      { disabled_packs: ["", "   "], disabled_skills: ["", " ", "/", "brand/"] },
      [],
      onWarn
    )
    //#then nothing is disabled and malformed entries are skipped silently
    expect(result.disabledPacks.size).toBe(0)
    expect(result.disabledSkills.size).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  test("deduplicates repeated valid entries", () => {
    //#given the same valid pack and skill listed more than once
    //#when resolving disables
    const result = resolvePackDisables({
      disabled_packs: ["brand", "brand"],
      disabled_skills: ["slides", "slides"],
    })
    //#then the sets collapse duplicates
    expect(result.disabledPacks).toEqual(new Set(["brand"]))
    expect(result.disabledSkills).toEqual(new Set(["slides"]))
  })
})
