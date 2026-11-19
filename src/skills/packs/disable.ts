import type { SkillPacksConfig } from "../../config/schema/skill-packs"
import { PACK_CATALOG, PACK_CATALOG_BY_ID } from "./catalog"
import type { InstalledPackSkill } from "./types"

/** Pack and skill identifiers a caller should skip at load time. */
export interface ResolvedPackDisables {
  /** Pack ids whose skills are excluded entirely. */
  disabledPacks: Set<string>
  /** Skill names excluded from the resolved pack skills. */
  disabledSkills: Set<string>
}

/** Minimal shape needed from a discovered skill: its name and owning pack. */
type DiscoveredPackSkill = Pick<InstalledPackSkill, "name" | "packId">

/** Every pack id shipped by the static catalog. */
const CATALOG_PACK_IDS: ReadonlySet<string> = new Set(Object.keys(PACK_CATALOG_BY_ID))

/** Skill name to owning pack id, for every skill the static catalog ships. */
const CATALOG_SKILL_PACKS = new Map<string, string>()
for (const entry of PACK_CATALOG) {
  for (const skill of entry.skills) {
    CATALOG_SKILL_PACKS.set(skill, entry.id)
  }
}

interface ScopedSkill {
  /** Pack id taken from a `pack/skill` identifier, when present. */
  packId?: string
  /** Bare skill name, without the pack prefix. */
  name: string
}

function trimEntry(entry: string): string | undefined {
  const trimmed = entry.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Splits `pack/skill` into its parts; a bare name leaves `packId` undefined. */
function splitScopedSkill(entry: string): ScopedSkill {
  const slash = entry.indexOf("/")
  if (slash === -1) return { name: entry }
  const packId = entry.slice(0, slash).trim()
  return {
    packId: packId.length === 0 ? undefined : packId,
    name: entry.slice(slash + 1).trim(),
  }
}

function warnOnce(
  warned: Set<string>,
  onWarn: (message: string) => void,
  key: string,
  message: string
): void {
  if (warned.has(key)) return
  warned.add(key)
  onWarn(message)
}

/**
 * Merges `disabled_packs` and `disabled_skills` from the skill-pack config into
 * the sets {@link loadInstalledPacks} consumes.
 *
 * Unknown names are reported once through `onWarn` and ignored, so a stale
 * config never breaks loading. The top-level `disabled_skills` setting is not
 * read here (R7): only the `skill_packs` block participates. Pure: no
 * filesystem, network, or `console` access — the default sink is a no-op.
 */
export function resolvePackDisables(
  config: SkillPacksConfig | undefined,
  discovered: readonly DiscoveredPackSkill[] = [],
  onWarn: (message: string) => void = () => {}
): ResolvedPackDisables {
  const disabledPacks = new Set<string>()
  const disabledSkills = new Set<string>()
  const warned = new Set<string>()

  const knownPacks = new Set<string>(CATALOG_PACK_IDS)
  const discoveredSkillPacks = new Map<string, string>()
  for (const skill of discovered) {
    knownPacks.add(skill.packId)
    discoveredSkillPacks.set(skill.name, skill.packId)
  }
  const knownSkills = new Set<string>([...CATALOG_SKILL_PACKS.keys(), ...discoveredSkillPacks.keys()])

  for (const raw of config?.disabled_packs ?? []) {
    const packId = trimEntry(raw)
    if (packId === undefined) continue
    if (!knownPacks.has(packId)) {
      warnOnce(
        warned,
        onWarn,
        `pack:${packId}`,
        `ignoring unknown skill pack "${packId}" in disabled_packs`
      )
      continue
    }
    disabledPacks.add(packId)
  }

  for (const raw of config?.disabled_skills ?? []) {
    const entry = trimEntry(raw)
    if (entry === undefined) continue
    const { packId, name } = splitScopedSkill(entry)
    if (name.length === 0) continue

    const owningPack =
      packId ?? discoveredSkillPacks.get(name) ?? CATALOG_SKILL_PACKS.get(name)
    // Pack-level disables win: the pack set already excludes these skills.
    if (owningPack !== undefined && disabledPacks.has(owningPack)) continue

    if (!knownSkills.has(name)) {
      warnOnce(
        warned,
        onWarn,
        `skill:${name}`,
        `ignoring unknown skill "${name}" in disabled_skills`
      )
      continue
    }
    disabledSkills.add(name)
  }

  return { disabledPacks, disabledSkills }
}
