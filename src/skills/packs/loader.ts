import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { PACK_CATALOG } from "./catalog"
import {
  CORE_PACK_ID,
  PACK_SKILL_FILENAME,
  PACK_SKILLS_DIRNAME,
} from "./constants"
import {
  DEFAULT_MAX_PACK_TEMPLATE_BYTES,
  isSafeSkillName,
  parseSkillFrontmatter,
  sanitizePackTemplate,
} from "./frontmatter"
import {
  type InstalledPackSummary,
  listInstalledPacks,
  PACK_LOCK_FILENAME,
  resolvePacksRoot,
} from "./store"
import type { InstalledPackSkill, PackRisk } from "./types"

/**
 * Resolves installed pack skills into the builtin skill shape.
 *
 * Installed pack content is untrusted: every `SKILL.md` is parsed with the
 * strict frontmatter reader, its body is sanitized (control tokens stripped,
 * `CLAUDE_PLUGIN_ROOT` rewritten, byte-capped), and every failure degrades to a
 * skipped skill instead of a thrown error. Results are cached and invalidated
 * when the newest `lock.json` mtime changes, because the installer rewrites the
 * lock after replacing pack files.
 */

export interface LoadInstalledPacksOptions {
  /** Packs root; defaults to `<opencodeConfigDir>/matrixx/skill-packs`. */
  root?: string
  /** Pack ids whose skills are excluded entirely. */
  disabledPacks?: readonly string[]
  /** Skill names excluded from the result (free strings, not schema names). */
  disabledSkills?: readonly string[]
}

interface PackCacheEntry {
  key: string
  skills: InstalledPackSkill[]
}

let cache: PackCacheEntry | null = null

/** Drops the in-process cache so the next load re-reads every lock and skill. */
export function invalidatePackCache(): void {
  cache = null
}

function lockMtimeMs(versionDir: string): number {
  try {
    return statSync(join(versionDir, PACK_LOCK_FILENAME)).mtimeMs
  } catch {
    // The lock vanished between the directory scan and the stat; treat it as
    // the oldest possible entry so a partial install never wins the max.
    return -1
  }
}

/** Cache key: the packs root plus the newest lock mtime across installed packs. */
function cacheKeyFor(root: string, packs: InstalledPackSummary[]): string {
  let newest = -1
  for (const pack of packs) {
    newest = Math.max(newest, lockMtimeMs(pack.dir))
  }
  return `${root}\u0000${newest}`
}

/** Skill directory names under `<versionDir>/skills`; empty when missing. */
function readSkillDirNames(versionDir: string): string[] {
  try {
    return readdirSync(join(versionDir, PACK_SKILLS_DIRNAME), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Raw `SKILL.md` text; null when the file is missing or unreadable. */
function readSkillDocument(skillRoot: string): string | null {
  try {
    return readFileSync(join(skillRoot, PACK_SKILL_FILENAME), "utf-8")
  } catch {
    return null
  }
}

/** Risk flags recorded at install time, falling back to the bundled catalog. */
function resolvedRisk(packId: string, lockRisks: PackRisk[]): PackRisk[] {
  if (lockRisks.length > 0) return lockRisks
  return PACK_CATALOG.find((entry) => entry.id === packId)?.risk ?? []
}

function loadPackSkill(
  pack: InstalledPackSummary,
  dirName: string
): InstalledPackSkill | null {
  const skillRoot = join(pack.dir, PACK_SKILLS_DIRNAME, dirName)
  const raw = readSkillDocument(skillRoot)
  if (raw === null) return null

  const parsed = parseSkillFrontmatter(raw)
  if (parsed === null) return null

  const name = isSafeSkillName(parsed.name)
    ? parsed.name
    : isSafeSkillName(dirName)
      ? dirName
      : null
  if (name === null) return null

  return {
    name,
    description: parsed.description,
    template: sanitizePackTemplate(parsed.body, {
      maxBytes: DEFAULT_MAX_PACK_TEMPLATE_BYTES,
      coreSkillRoot: skillRoot,
    }),
    ...(parsed.license !== undefined ? { license: parsed.license } : {}),
    ...(parsed.compatibility !== undefined ? { compatibility: parsed.compatibility } : {}),
    ...(parsed.argumentHint !== undefined ? { argumentHint: parsed.argumentHint } : {}),
    packId: pack.lock.packId,
    packRoot: pack.dir,
    skillRoot,
    risk: resolvedRisk(pack.lock.packId, pack.lock.risks),
    source: "pack",
  }
}

/** Core pack first, then pack id, then skill name. */
function comparePackSkills(a: InstalledPackSkill, b: InstalledPackSkill): number {
  const aCore = a.packId === CORE_PACK_ID
  const bCore = b.packId === CORE_PACK_ID
  if (aCore !== bCore) return aCore ? -1 : 1
  const byPack = a.packId.localeCompare(b.packId)
  return byPack !== 0 ? byPack : a.name.localeCompare(b.name)
}

function loadUnfiltered(root: string): InstalledPackSkill[] {
  const packs = listInstalledPacks(root)
  const key = cacheKeyFor(root, packs)
  if (cache !== null && cache.key === key) return cache.skills

  const skills: InstalledPackSkill[] = []
  for (const pack of packs) {
    for (const dirName of readSkillDirNames(pack.dir)) {
      const skill = loadPackSkill(pack, dirName)
      if (skill !== null) skills.push(skill)
    }
  }
  skills.sort(comparePackSkills)

  cache = { key, skills }
  return skills
}

/**
 * Loads every installed pack skill, excluding disabled packs and skills.
 *
 * Missing roots, unreadable skills, and malformed frontmatter never throw:
 * they yield fewer (or zero) entries.
 */
export function loadInstalledPacks(options: LoadInstalledPacksOptions = {}): InstalledPackSkill[] {
  const root = resolvePacksRoot({ root: options.root })
  const disabledPacks = new Set(options.disabledPacks ?? [])
  const disabledSkills = new Set(options.disabledSkills ?? [])

  return loadUnfiltered(root).filter(
    (skill) => !disabledPacks.has(skill.packId) && !disabledSkills.has(skill.name)
  )
}

/**
 * Absolute path of an installed pack's skill directory,
 * `<root>/<packId>/<version>/skills/<packId>`. Selects the most recent version
 * when several are installed; undefined when the pack is not installed.
 */
export function resolveCorePackRoot(
  packId: string = CORE_PACK_ID,
  root?: string
): string | undefined {
  if (!isSafeSkillName(packId)) return undefined

  const packsRoot = resolvePacksRoot({ root })
  const installed = listInstalledPacks(packsRoot).filter((pack) => pack.packId === packId)
  const latest = installed.at(-1)
  if (latest === undefined) return undefined
  return join(latest.dir, PACK_SKILLS_DIRNAME, packId)
}
