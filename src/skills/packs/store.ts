import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { getOpenCodeConfigDir } from "../../shared/config/opencode-config-dir"
import { readJsoncFile } from "../../shared/text/jsonc-parser"
import { assertSafeSkillName } from "./frontmatter"
import type { PackLock } from "./types"

/**
 * On-disk store for external skill packs.
 *
 * Layout: `<root>/<packId>/<version>/lock.json` plus the pack payload under
 * `skills/`. Every filesystem access for packs goes through this module so the
 * installer, doctor, and uninstall paths agree on one layout and one atomic
 * write discipline.
 */

/** Directory under the OpenCode config dir that holds Matrixx state. */
export const MATRIXX_CONFIG_DIRNAME = "matrixx"
/** Directory under `MATRIXX_CONFIG_DIRNAME` that holds installed packs. */
export const SKILL_PACKS_DIRNAME = "skill-packs"
/** Lockfile written at the root of every installed version directory. */
export const PACK_LOCK_FILENAME = "lock.json"

/** One installed pack version as discovered on disk. */
export interface InstalledPackSummary {
	/** Pack identifier (the first path segment under the packs root). */
	packId: string
	/** Version identifier (the second path segment under the packs root). */
	version: string
	/** Absolute path to the version directory. */
	dir: string
	/** Parsed lockfile recorded for this version. */
	lock: PackLock
}

export type PacksRootConfig = {
	/** Root directory holding skill packs; resolved to an absolute path. */
	root?: string
}

/** Raised when a pack id or version would escape the packs root. */
export class UnsafePackPathError extends Error {
	readonly code = "UNSAFE_PACK_PATH"

	constructor(
		readonly label: string,
		readonly segment: string,
	) {
		super(`Unsafe pack ${label}: ${JSON.stringify(segment)}`)
		this.name = "UnsafePackPathError"
	}
}

/**
 * Resolves the packs root: an explicit `config.root` (made absolute), else
 * `<opencodeConfigDir>/matrixx/skill-packs`.
 */
export function resolvePacksRoot(config?: PacksRootConfig): string {
	const configuredRoot = config?.root?.trim()
	if (configuredRoot) {
		return resolve(configuredRoot)
	}
	return join(getOpenCodeConfigDir({ binary: "opencode" }), MATRIXX_CONFIG_DIRNAME, SKILL_PACKS_DIRNAME)
}

function assertSafePathSegment(segment: string, label: string): void {
	if (
		segment.length === 0 ||
		segment === "." ||
		segment === ".." ||
		segment.includes("/") ||
		segment.includes("\\") ||
		segment.includes("\0") ||
		isAbsolute(segment)
	) {
		throw new UnsafePackPathError(label, segment)
	}
}

/** `<root>/<packId>/<version>` — the directory that owns one `lock.json`. */
export function packVersionDir(root: string, packId: string, version: string): string {
	assertSafeSkillName(packId)
	assertSafePathSegment(version, "version")
	return join(root, packId, version)
}

function isPackLock(value: unknown): value is PackLock {
	if (typeof value !== "object" || value === null) return false
	const record = value as Record<string, unknown>
	return (
		typeof record.packId === "string" &&
		typeof record.version === "string" &&
		typeof record.integrity === "string" &&
		typeof record.sourceUrl === "string" &&
		typeof record.installedAt === "string" &&
		typeof record.pythonRequired === "boolean" &&
		Array.isArray(record.files) &&
		record.files.every((file) => typeof file === "string") &&
		Array.isArray(record.skills) &&
		Array.isArray(record.risks)
	)
}

/** Reads `<dir>/lock.json`; null when absent, unreadable, or malformed. */
export function readLock(dir: string): PackLock | null {
	const parsed = readJsoncFile<unknown>(join(dir, PACK_LOCK_FILENAME))
	return isPackLock(parsed) ? parsed : null
}

/**
 * Atomically writes `<dir>/lock.json`: temp file with a pid suffix, then
 * `renameSync`. A crash leaves either the previous lock or none — never a
 * torn file. The temp file is removed if the write or rename fails.
 */
export function writeLockAtomic(dir: string, lock: PackLock): void {
	mkdirSync(dir, { recursive: true })
	const target = join(dir, PACK_LOCK_FILENAME)
	const temp = `${target}.tmp.${process.pid}`
	try {
		writeFileSync(temp, `${JSON.stringify(lock, null, 2)}\n`, "utf-8")
		renameSync(temp, target)
	} finally {
		if (existsSync(temp)) {
			rmSync(temp, { force: true })
		}
	}
}

/** Directory names under `dir`; empty when it is missing or unreadable. */
function readDirNames(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
	} catch {
		return []
	}
}

/** Every installed pack version under `root`; directories without a lock are ignored. */
export function listInstalledPacks(root: string): InstalledPackSummary[] {
	const summaries: InstalledPackSummary[] = []
	for (const packId of readDirNames(root)) {
		const packDir = join(root, packId)
		for (const version of readDirNames(packDir)) {
			const dir = join(packDir, version)
			const lock = readLock(dir)
			if (lock === null) continue
			summaries.push({ packId, version, dir, lock })
		}
	}
	return summaries.sort((a, b) =>
		a.packId === b.packId ? a.version.localeCompare(b.version) : a.packId.localeCompare(b.packId),
	)
}

/**
 * Removes one installed version, or every version of `packId` when `version`
 * is omitted. Returns the version directories that were removed; unknown packs
 * and versions are a no-op.
 */
export function removeInstalledPack(root: string, packId: string, version?: string): string[] {
	assertSafeSkillName(packId)
	const packDir = join(root, packId)

	if (version !== undefined) {
		assertSafePathSegment(version, "version")
		const dir = join(packDir, version)
		if (!existsSync(dir)) return []
		rmSync(dir, { recursive: true, force: true })
		return [dir]
	}

	const versions = readDirNames(packDir)
	if (versions.length === 0) return []
	const removed = versions.map((entry) => join(packDir, entry))
	rmSync(packDir, { recursive: true, force: true })
	return removed
}
