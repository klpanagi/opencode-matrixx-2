import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { warn } from "../../shared/runtime/logger"
import { PACK_CATALOG, PACK_CATALOG_BY_ID } from "../../skills/packs/catalog"
import {
  CORE_PACK_ID,
  PACK_ASSETS_DIRNAME,
  PACK_SKILL_FILENAME,
  PACK_SKILLS_DIRNAME,
} from "../../skills/packs/constants"
import {
  type InstalledPackSummary,
  listInstalledPacks,
  packVersionDir,
  removeInstalledPack,
  resolvePacksRoot,
  writeLockAtomic,
} from "../../skills/packs/store"
import type {
  PackCatalogEntry,
  PackId,
  PackLock,
  PackRisk,
  PackSkillLock,
} from "../../skills/packs/types"
import { PINNED_INTEGRITY } from "./constants"
import { generateCoreSkill, materializeAuxSkills } from "./generate"
import { IntegrityMismatchError, verifySha512 } from "./integrity"
import { downloadTarball, fetchPackument } from "./registry"
import { extractTarball } from "./tar"

/**
 * Skill-pack installer.
 *
 * One install is a preflight → verified download → staged materialisation →
 * atomic swap pipeline:
 *
 * 1. Resolve the catalog entry and enforce the consent flags declared by its
 *    risk list (`requiresPython` and `requiresNode` never block).
 * 2. Fetch the packument and refuse it unless its digest equals the pinned
 *    release digest, before a single byte of the tarball is read.
 * 3. Download the tarball and verify its SHA-512 against the pin *before*
 *    extraction, so a tampered archive never reaches the filesystem.
 * 4. Extract and render into `<root>/.staging-<packId>-<pid>`.
 * 5. Move an existing install aside, rename the staging directory onto
 *    `<root>/<packId>/<version>`, write `lock.json` atomically, then drop the
 *    backup. A crash mid-swap restores the previous install.
 *
 * Any failure removes the staging directory and the downloaded tarball, so a
 * botched install never leaves a half-populated pack behind.
 */

/** Raised when a pack id is not part of the bundled catalog. */
export class PackUnknownError extends Error {
  readonly code = "PACK_UNKNOWN"

  constructor(readonly packId: string) {
    super(`Unknown skill pack: ${packId}`)
    this.name = "PackUnknownError"
  }
}

/**
 * Raised when a pack needs a consent flag the caller did not set. `risks`
 * lists only the blocking requirements, never the satisfied ones.
 */
export class PackRequiresConsentError extends Error {
  readonly code = "PACK_REQUIRES_CONSENT"

  constructor(
    readonly packId: PackId,
    readonly risks: PackRisk[],
  ) {
    super(`Skill pack ${packId} requires consent for ${risks.join(", ")}`)
    this.name = "PackRequiresConsentError"
  }
}

/** Raised when the version directory already exists and `force` was not set. */
export class PackAlreadyInstalledError extends Error {
  readonly code = "PACK_ALREADY_INSTALLED"

  constructor(
    readonly packId: PackId,
    readonly dir: string,
  ) {
    super(`Skill pack ${packId} is already installed at ${dir}; pass force to replace it`)
    this.name = "PackAlreadyInstalledError"
  }
}

/**
 * Raised when the registry advertises a digest other than the pinned release.
 *
 * Extends {@link IntegrityMismatchError} so callers that already handle tarball
 * digest failures catch this too, but reports the pack-level cause instead of
 * byte lengths (both digests are always 64 bytes when they merely differ).
 */
export class PinnedIntegrityMismatchError extends IntegrityMismatchError {
  constructor(expected: string, received: string) {
    super(sha512DigestBytes(expected), sha512DigestBytes(received))
    this.name = "PinnedIntegrityMismatchError"
    this.message = "Registry integrity does not match the pinned ui-ux-pro-max-cli release digest"
  }
}

export interface InstallPackOptions {
  /** Pack identifier from the bundled catalog. */
  packId: string
  /** Exact package version; defaults to the version pinned by the catalog entry. */
  version?: string
  /** Packs root; defaults to `<opencode config>/matrixx/skill-packs`. */
  root?: string
  /** Replace an existing version directory instead of failing. */
  force?: boolean
  /** Preflight + download + verify only; never writes the pack. */
  dryRun?: boolean
  /** Consent for packs with the `requiresNetwork` risk. */
  allowNetworkPacks?: boolean
  /** Consent for packs with the `requiresApiKeys` risk. */
  allowApiKeyPacks?: boolean
  /** Registry base URL override (mirrors, tests). */
  registryUrl?: string
  /** Fetch implementation override; tests inject a local fixture server. */
  fetchFn?: typeof fetch
  /** Pinned digest override; defaults to {@link PINNED_INTEGRITY}. Tests only. */
  pinnedIntegrity?: string
}

export interface InstallPackResult {
  packId: PackId
  version: string
  /** Absolute path of the installed (or planned, for dry runs) version directory. */
  dir: string
  /** Skill directory names materialised by the install. */
  skills: string[]
  lock: PackLock
}

export interface RemovePackOptions {
  /** Packs root; defaults to `<opencode config>/matrixx/skill-packs`. */
  root?: string
  /** Remove only this version instead of every installed version. */
  version?: string
}

export interface ListPacksOptions {
  /** Packs root; defaults to `<opencode config>/matrixx/skill-packs`. */
  root?: string
}

function sha512DigestBytes(integrity: string): number {
  const entry = integrity
    .trim()
    .split(/\s+/)
    .find((value) => value.startsWith("sha512-"))
  return entry === undefined ? 0 : Buffer.from(entry.slice("sha512-".length), "base64").length
}

function isPackId(value: string): value is PackId {
  return Object.hasOwn(PACK_CATALOG_BY_ID, value)
}

function resolvePack(packId: string): PackCatalogEntry {
  if (!isPackId(packId)) throw new PackUnknownError(packId)
  return PACK_CATALOG_BY_ID[packId]
}

/** Rejects packs whose declared risks the caller has not consented to. */
function assertConsent(pack: PackCatalogEntry, options: InstallPackOptions): void {
  const blocked: PackRisk[] = []
  if (pack.risk.includes("requiresNetwork") && options.allowNetworkPacks !== true) {
    blocked.push("requiresNetwork")
  }
  if (pack.risk.includes("requiresApiKeys") && options.allowApiKeyPacks !== true) {
    blocked.push("requiresApiKeys")
  }
  if (blocked.length > 0) throw new PackRequiresConsentError(pack.id, blocked)
}

/** File paths under `rootDir`, relative to it and sorted for stable locks. */
function collectFiles(rootDir: string, relativeDir = ""): string[] {
  const currentDir = relativeDir.length > 0 ? join(rootDir, relativeDir) : rootDir
  const files: string[] = []

  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const relativePath = relativeDir.length > 0 ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files.sort()
}

/** Per-skill lock records for every skill directory created by the install. */
function collectSkillLocks(staging: string): PackSkillLock[] {
  const skillsDir = join(staging, PACK_SKILLS_DIRNAME)
  if (!existsSync(skillsDir)) return []

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillRoot = `${PACK_SKILLS_DIRNAME}/${entry.name}`
      return {
        name: entry.name,
        skillRoot,
        files: collectFiles(join(skillsDir, entry.name)).map((file) => `${skillRoot}/${file}`),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function buildLock(
  pack: PackCatalogEntry,
  version: string,
  integrity: string,
  sourceUrl: string,
  staging: string,
): PackLock {
  return {
    packId: pack.id,
    version,
    integrity,
    sourceUrl,
    installedAt: new Date().toISOString(),
    files: collectFiles(staging),
    skills: collectSkillLocks(staging),
    risks: [...pack.risk],
    pythonRequired: pack.risk.includes("requiresPython"),
  }
}

/**
 * Dry-run locks describe intent only: no file has been written, so `files` is
 * empty and each catalog skill gets a record with an empty file list.
 */
function buildPlannedLock(
  pack: PackCatalogEntry,
  version: string,
  integrity: string,
  sourceUrl: string,
): PackLock {
  return {
    packId: pack.id,
    version,
    integrity,
    sourceUrl,
    installedAt: new Date().toISOString(),
    files: [],
    skills: pack.skills.map((name) => ({
      name,
      skillRoot: `${PACK_SKILLS_DIRNAME}/${name}`,
      files: [],
    })),
    risks: [...pack.risk],
    pythonRequired: pack.risk.includes("requiresPython"),
  }
}

/**
 * The core renderer embeds the skill root in the document (the `{{SCRIPT_PATH}}`
 * placeholder and any `CLAUDE_PLUGIN_ROOT` substitution). During staging that
 * root is the throwaway staging directory, so rewrite the generated document to
 * the committed path before the atomic rename.
 */
function rewriteSkillRoot(skillFile: string, stagingRoot: string, finalRoot: string): void {
  const document = readFileSync(skillFile, "utf-8")
  if (!document.includes(stagingRoot)) return
  writeFileSync(skillFile, document.split(stagingRoot).join(finalRoot), "utf-8")
}

/**
 * Renders the pack payload into `<staging>/skills`.
 *
 * The core pack is generated (its `SKILL.md` is not shipped by the tarball and
 * `data/` + `scripts/` are copied next to it). Every auxiliary pack copies only
 * its own skill directory, so installing `brand` never drags in `design`.
 */
function stagePackSkills(pack: PackCatalogEntry, staging: string, finalDir: string): void {
  const assetsDir = join(staging, PACK_ASSETS_DIRNAME)
  const destSkillsDir = join(staging, PACK_SKILLS_DIRNAME)

  if (pack.id === CORE_PACK_ID) {
    const stagingSkillRoot = join(destSkillsDir, CORE_PACK_ID)
    const finalSkillRoot = join(finalDir, PACK_SKILLS_DIRNAME, CORE_PACK_ID)
    generateCoreSkill({
      assetsDir,
      coreSkillRoot: stagingSkillRoot,
      scriptPathAbsolute: join(finalSkillRoot, "scripts", "search.py"),
    })
    rewriteSkillRoot(join(stagingSkillRoot, PACK_SKILL_FILENAME), stagingSkillRoot, finalSkillRoot)
    return
  }

  const excludeSkills = PACK_CATALOG.filter(
    (entry) => entry.id !== CORE_PACK_ID && entry.id !== pack.id,
  ).map((entry) => entry.id)
  materializeAuxSkills({
    assetsSkillsDir: join(assetsDir, PACK_SKILLS_DIRNAME),
    destSkillsDir,
    excludeSkills,
  })
}

/**
 * Installs one catalog pack from the pinned npm release.
 *
 * Consent, catalog membership and the existing-install check run before any
 * network access. Integrity is asserted on the packument and again on the
 * downloaded bytes, both before extraction.
 */
export async function installPack(options: InstallPackOptions): Promise<InstallPackResult> {
  const pack = resolvePack(options.packId)
  assertConsent(pack, options)

  const version = options.version ?? pack.version
  const root = resolvePacksRoot({ root: options.root })
  const finalDir = packVersionDir(root, pack.id, version)
  if (existsSync(finalDir) && options.force !== true) {
    throw new PackAlreadyInstalledError(pack.id, finalDir)
  }

  const expectedIntegrity = options.pinnedIntegrity ?? PINNED_INTEGRITY
  const packument = await fetchPackument(pack.packageName, version, {
    registryUrl: options.registryUrl,
    fetchFn: options.fetchFn,
  })
  if (packument.integrity !== expectedIntegrity) {
    throw new PinnedIntegrityMismatchError(expectedIntegrity, packument.integrity)
  }

  const tempDir = mkdtempSync(join(tmpdir(), "matrixx-pack-"))
  try {
    const tgzPath = join(tempDir, `${pack.id}-${version}.tgz`)
    await downloadTarball(packument.tarball, tgzPath, { fetchFn: options.fetchFn })
    verifySha512(tgzPath, expectedIntegrity)

    if (options.dryRun === true) {
      return {
        packId: pack.id,
        version,
        dir: finalDir,
        skills: [...pack.skills],
        lock: buildPlannedLock(pack, version, expectedIntegrity, packument.tarball),
      }
    }

    mkdirSync(root, { recursive: true })
    const staging = join(root, `.staging-${pack.id}-${process.pid}`)
    rmSync(staging, { recursive: true, force: true })

    try {
      extractTarball(tgzPath, staging)
      stagePackSkills(pack, staging, finalDir)
      // The extracted `assets/` tree is intermediate input: everything the pack
      // keeps already lives under `skills/`. Dropping it keeps the lock and the
      // installed directory limited to the payload the loader reads.
      rmSync(join(staging, PACK_ASSETS_DIRNAME), { recursive: true, force: true })

      const lock = buildLock(pack, version, expectedIntegrity, packument.tarball, staging)

      // Old, rename, rm: an existing install is moved aside instead of deleted,
      // so a crash between the two renames can still restore it. A leftover
      // backup is safe; a missing install is not.
      const backupDir = existsSync(finalDir) ? `${finalDir}.backup-${randomUUID()}` : null
      if (backupDir !== null) renameSync(finalDir, backupDir)
      mkdirSync(join(root, pack.id), { recursive: true })
      try {
        renameSync(staging, finalDir)
      } catch (error) {
        if (backupDir !== null) renameSync(backupDir, finalDir)
        throw error
      }
      writeLockAtomic(finalDir, lock)
      if (backupDir !== null) {
        try {
          rmSync(backupDir, { recursive: true, force: true })
        } catch (error) {
          warn("skill-pack: could not remove install backup", {
            backupDir,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return {
        packId: pack.id,
        version,
        dir: finalDir,
        skills: lock.skills.map((skill) => skill.name),
        lock,
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/** Removes an installed pack version (or every version) from the packs root. */
export function removePack(packId: string, options: RemovePackOptions = {}): string[] {
  const root = resolvePacksRoot({ root: options.root })
  return removeInstalledPack(root, packId, options.version)
}

/** Lists every installed pack version under the packs root. */
export function listPacks(options: ListPacksOptions = {}): InstalledPackSummary[] {
  return listInstalledPacks(resolvePacksRoot({ root: options.root }))
}
