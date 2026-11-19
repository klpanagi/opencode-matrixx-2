/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	PACK_LOCK_FILENAME,
	listInstalledPacks,
	packVersionDir,
	readLock,
	removeInstalledPack,
	resolvePacksRoot,
	writeLockAtomic,
} from "../../../src/skills/packs/store"
import type { PackLock } from "../../../src/skills/packs/types"

function makeLock(overrides: Partial<PackLock> = {}): PackLock {
	return {
		packId: "ui-ux-pro-max",
		version: "2.15.0",
		integrity: "sha512-deadbeef",
		sourceUrl: "https://example.test/ui-ux-pro-max.tgz",
		installedAt: "2026-01-01T00:00:00.000Z",
		files: ["skills/ui-ux-pro-max/SKILL.md"],
		skills: [
			{
				name: "ui-ux-pro-max",
				skillRoot: "skills/ui-ux-pro-max",
				files: ["skills/ui-ux-pro-max/SKILL.md"],
			},
		],
		risks: ["requiresPython"],
		pythonRequired: true,
		...overrides,
	}
}

describe("resolvePacksRoot", () => {
	test("resolves an explicit config root to an absolute path", () => {
		//#given
		const relativeRoot = join("some", "relative", "packs")

		//#when
		const root = resolvePacksRoot({ root: relativeRoot })

		//#then
		expect(root).toBe(resolve(relativeRoot))
		expect(root.startsWith("/") || /^[A-Za-z]:/.test(root) || root.startsWith("\\\\")).toBe(true)
	})

	test("defaults to <configDir>/matrixx/skill-packs", () => {
		//#given
		const expectedSuffix = join("matrixx", "skill-packs")

		//#when
		const root = resolvePacksRoot()

		//#then
		expect(root.endsWith(expectedSuffix)).toBe(true)
	})
})

describe("packVersionDir", () => {
	test("joins root, pack id, and version", () => {
		//#given
		const root = "/packs"

		//#when
		const dir = packVersionDir(root, "design-system", "1.2.3")

		//#then
		expect(dir).toBe(join(root, "design-system", "1.2.3"))
	})

	test("rejects traversal in the pack id", () => {
		//#given
		const root = "/packs"

		//#when / #then
		expect(() => packVersionDir(root, "../escape", "1.0.0")).toThrow()
		expect(() => packVersionDir(root, "/abs", "1.0.0")).toThrow()
	})

	test("rejects traversal in the version", () => {
		//#given
		const root = "/packs"

		//#when / #then
		expect(() => packVersionDir(root, "brand", "..")).toThrow()
		expect(() => packVersionDir(root, "brand", "../2.0.0")).toThrow()
		expect(() => packVersionDir(root, "brand", "/abs")).toThrow()
	})
})

describe("writeLockAtomic / readLock", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "matrixx-pack-store-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("round-trips a lock file", () => {
		//#given
		const dir = packVersionDir(root, "ui-ux-pro-max", "2.15.0")
		const lock = makeLock()

		//#when
		writeLockAtomic(dir, lock)
		const read = readLock(dir)

		//#then
		expect(read).toEqual(lock)
	})

	test("creates missing parent directories", () => {
		//#given
		const dir = packVersionDir(root, "brand", "1.0.0")
		expect(existsSync(root)).toBe(true)
		expect(existsSync(join(root, "brand"))).toBe(false)

		//#when
		writeLockAtomic(dir, makeLock({ packId: "brand", version: "1.0.0" }))

		//#then
		expect(existsSync(join(dir, PACK_LOCK_FILENAME))).toBe(true)
	})

	test("leaves no temp residue after a successful write", () => {
		//#given
		const dir = packVersionDir(root, "ui-ux-pro-max", "2.15.0")

		//#when
		writeLockAtomic(dir, makeLock())

		//#then
		expect(readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([])
	})

	test("returns null when the directory has no lock file", () => {
		//#given
		const dir = packVersionDir(root, "slides", "1.0.0")
		mkdirSync(dir, { recursive: true })

		//#when
		const lock = readLock(dir)

		//#then
		expect(lock).toBeNull()
	})

	test("returns null when the lock file is corrupt", () => {
		//#given
		const dir = packVersionDir(root, "banner-design", "1.0.0")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, PACK_LOCK_FILENAME), "{ not json", "utf-8")

		//#when
		const lock = readLock(dir)

		//#then
		expect(lock).toBeNull()
	})

	test("returns null when the lock file has the wrong shape", () => {
		//#given
		const dir = packVersionDir(root, "ui-styling", "1.0.0")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, PACK_LOCK_FILENAME), JSON.stringify({ hello: "world" }), "utf-8")

		//#when
		const lock = readLock(dir)

		//#then
		expect(lock).toBeNull()
	})
})

describe("listInstalledPacks", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "matrixx-pack-store-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("returns an empty list when the root does not exist", () => {
		//#given
		const missingRoot = join(root, "missing")

		//#when
		const packs = listInstalledPacks(missingRoot)

		//#then
		expect(packs).toEqual([])
	})

	test("lists every version directory holding a lock file", () => {
		//#given
		writeLockAtomic(packVersionDir(root, "ui-ux-pro-max", "2.15.0"), makeLock())
		writeLockAtomic(
			packVersionDir(root, "design-system", "1.0.0"),
			makeLock({ packId: "design-system", version: "1.0.0" }),
		)
		writeLockAtomic(
			packVersionDir(root, "design-system", "1.1.0"),
			makeLock({ packId: "design-system", version: "1.1.0" }),
		)

		//#when
		const packs = listInstalledPacks(root)

		//#then
		expect(packs.map((pack) => `${pack.packId}@${pack.version}`).sort()).toEqual([
			"design-system@1.0.0",
			"design-system@1.1.0",
			"ui-ux-pro-max@2.15.0",
		])
		expect(packs[0]?.dir).toBe(packVersionDir(root, packs[0]?.packId ?? "", packs[0]?.version ?? ""))
		expect(packs[0]?.lock.packId).toBe(packs[0]?.packId)
	})

	test("ignores version directories without a lock file", () => {
		//#given
		writeLockAtomic(packVersionDir(root, "brand", "1.0.0"), makeLock({ packId: "brand", version: "1.0.0" }))
		mkdirSync(packVersionDir(root, "slides", "1.0.0"), { recursive: true })

		//#when
		const packs = listInstalledPacks(root)

		//#then
		expect(packs.map((pack) => pack.packId)).toEqual(["brand"])
	})
})

describe("removeInstalledPack", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "matrixx-pack-store-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("removes only the targeted version", () => {
		//#given
		const oldDir = packVersionDir(root, "ui-ux-pro-max", "2.14.0")
		const newDir = packVersionDir(root, "ui-ux-pro-max", "2.15.0")
		writeLockAtomic(oldDir, makeLock({ version: "2.14.0" }))
		writeLockAtomic(newDir, makeLock({ version: "2.15.0" }))

		//#when
		const removed = removeInstalledPack(root, "ui-ux-pro-max", "2.14.0")

		//#then
		expect(removed).toEqual([oldDir])
		expect(existsSync(oldDir)).toBe(false)
		expect(existsSync(newDir)).toBe(true)
	})

	test("removes all versions when no version is given", () => {
		//#given
		const first = packVersionDir(root, "ui-ux-pro-max", "2.14.0")
		const second = packVersionDir(root, "ui-ux-pro-max", "2.15.0")
		writeLockAtomic(first, makeLock({ version: "2.14.0" }))
		writeLockAtomic(second, makeLock({ version: "2.15.0" }))

		//#when
		const removed = removeInstalledPack(root, "ui-ux-pro-max")

		//#then
		expect(removed.sort()).toEqual([first, second].sort())
		expect(existsSync(first)).toBe(false)
		expect(existsSync(second)).toBe(false)
		expect(existsSync(join(root, "ui-ux-pro-max"))).toBe(false)
	})

	test("returns an empty list for an unknown pack", () => {
		//#given
		const emptyRoot = join(root, "missing")

		//#when
		const removed = removeInstalledPack(emptyRoot, "brand")

		//#then
		expect(removed).toEqual([])
	})

	test("returns an empty list for an unknown version", () => {
		//#given
		writeLockAtomic(packVersionDir(root, "brand", "1.0.0"), makeLock({ packId: "brand", version: "1.0.0" }))

		//#when
		const removed = removeInstalledPack(root, "brand", "9.9.9")

		//#then
		expect(removed).toEqual([])
		expect(existsSync(packVersionDir(root, "brand", "1.0.0"))).toBe(true)
	})

	test("rejects an unsafe pack id", () => {
		//#given
		const unsafePackId = "../brand"

		//#when / #then
		expect(() => removeInstalledPack(root, unsafePackId)).toThrow()
	})

	test("rejects an unsafe version", () => {
		//#given
		const unsafeVersion = "../../etc"

		//#when / #then
		expect(() => removeInstalledPack(root, "brand", unsafeVersion)).toThrow()
	})
})
