/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PACK_SKILL_FILENAME } from "../../../src/skills/packs/constants"
import { PACK_LOCK_FILENAME } from "../../../src/skills/packs/store"
import {
	invalidatePackCache,
	loadInstalledPacks,
	resolveCorePackRoot,
} from "../../../src/skills/packs/loader"
import type { PackId, PackLock } from "../../../src/skills/packs/types"

const CORE_ID: PackId = "ui-ux-pro-max"
const ALPHA_ID: PackId = "design-system"
const ALPHA_SKILLS = [
	"alpha-a",
	"alpha-b",
	"alpha-c",
	"alpha-d",
	"alpha-e",
	"alpha-f",
] as const

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "matrixx-pack-loader-"))
	invalidatePackCache()
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	invalidatePackCache()
})

function makeLock(packId: PackId, version: string, overrides: Partial<PackLock> = {}): PackLock {
	return {
		packId,
		version,
		integrity: "sha512-deadbeef",
		sourceUrl: `https://example.test/${packId}.tgz`,
		installedAt: "2026-01-01T00:00:00.000Z",
		files: [],
		skills: [],
		risks: [],
		pythonRequired: false,
		...overrides,
	}
}

function writeLock(versionDir: string, lock: PackLock): string {
	mkdirSync(versionDir, { recursive: true })
	const lockPath = join(versionDir, PACK_LOCK_FILENAME)
	writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
	return lockPath
}

interface WriteSkillOptions {
	description?: string
	body?: string
	frontmatterName?: string
}

function writeSkill(
	versionDir: string,
	dirName: string,
	options: WriteSkillOptions = {}
): string {
	const skillDir = join(versionDir, "skills", dirName)
	mkdirSync(skillDir, { recursive: true })
	const frontmatterName = options.frontmatterName ?? dirName
	const description = options.description ?? `${dirName} description`
	const body = options.body ?? `# ${dirName}\n\nBody for ${dirName}.`
	writeFileSync(
		join(skillDir, PACK_SKILL_FILENAME),
		["---", `name: ${frontmatterName}`, `description: ${description}`, "---", body, ""].join("\n")
	)
	return skillDir
}

function installCore(version = "2.15.0"): { dir: string; skillDir: string } {
	const dir = join(root, CORE_ID, version)
	writeLock(dir, makeLock(CORE_ID, version, { risks: ["requiresPython"] }))
	const skillDir = writeSkill(dir, CORE_ID, { description: "Core design intelligence" })
	return { dir, skillDir }
}

function installAlpha(version = "2.15.0"): { dir: string } {
	const dir = join(root, ALPHA_ID, version)
	writeLock(dir, makeLock(ALPHA_ID, version, { risks: ["requiresNode"] }))
	for (const name of ALPHA_SKILLS) {
		writeSkill(dir, name)
	}
	return { dir }
}

describe("loadInstalledPacks", () => {
	test("parses every installed skill and stamps provenance", () => {
		//#given
		const core = installCore()
		const alpha = installAlpha()

		//#when
		const skills = loadInstalledPacks({ root })

		//#then
		expect(skills).toHaveLength(7)
		const coreSkill = skills.find((skill) => skill.name === CORE_ID)
		expect(coreSkill).toBeDefined()
		expect(coreSkill?.description).toBe("Core design intelligence")
		expect(coreSkill?.template).toContain("Body for ui-ux-pro-max.")
		expect(coreSkill?.packId).toBe(CORE_ID)
		expect(coreSkill?.packRoot).toBe(core.dir)
		expect(coreSkill?.skillRoot).toBe(core.skillDir)
		expect(coreSkill?.risk).toEqual(["requiresPython"])
		expect(coreSkill?.source).toBe("pack")

		const alphaSkill = skills.find((skill) => skill.name === "alpha-d")
		expect(alphaSkill?.packRoot).toBe(alpha.dir)
		expect(alphaSkill?.skillRoot).toBe(join(alpha.dir, "skills", "alpha-d"))
		expect(alphaSkill?.risk).toEqual(["requiresNode"])
	})

	test("orders core pack skills first, then by pack id and skill name", () => {
		//#given
		installAlpha()
		installCore()

		//#when
		const names = loadInstalledPacks({ root }).map((skill) => skill.name)

		//#then
		expect(names).toEqual([CORE_ID, ...ALPHA_SKILLS])
	})

	test("sanitizes untrusted templates and substitutes CLAUDE_PLUGIN_ROOT", () => {
		//#given
		const core = installCore()
		writeSkill(core.dir, CORE_ID, {
			body: "<tool_use>run CLAUDE_PLUGIN_ROOT/scripts/search.py</tool_use>",
		})

		//#when
		const skill = loadInstalledPacks({ root }).find((entry) => entry.name === CORE_ID)

		//#then
		expect(skill?.template).not.toContain("<tool_use>")
		expect(skill?.template).toContain(join(core.skillDir, "scripts", "search.py"))
	})

	test("falls back to the directory name when the frontmatter name is unsafe", () => {
		//#given
		const core = installCore()
		writeSkill(core.dir, "fallback-name", { frontmatterName: "Bad_Name" })

		//#when
		const names = loadInstalledPacks({ root }).map((skill) => skill.name)

		//#then
		expect(names).toContain("fallback-name")
		expect(names).not.toContain("Bad_Name")
	})

	test("skips skills whose SKILL.md has no parseable frontmatter", () => {
		//#given
		installCore()
		const dir = installAlpha()
		const brokenDir = join(dir.dir, "skills", "broken")
		mkdirSync(brokenDir, { recursive: true })
		writeFileSync(join(brokenDir, PACK_SKILL_FILENAME), "# no frontmatter\n")

		//#when
		const skills = loadInstalledPacks({ root })

		//#then
		expect(skills).toHaveLength(7)
		expect(skills.map((skill) => skill.name)).not.toContain("broken")
	})

	test("excludes a whole pack through disabledPacks", () => {
		//#given
		installCore()
		installAlpha()

		//#when
		const skills = loadInstalledPacks({ root, disabledPacks: [ALPHA_ID] })

		//#then
		expect(skills.map((skill) => skill.name)).toEqual([CORE_ID])
	})

	test("excludes individual skills through disabledSkills", () => {
		//#given
		installCore()
		installAlpha()

		//#when
		const skills = loadInstalledPacks({ root, disabledSkills: ["alpha-c", CORE_ID] })

		//#then
		expect(skills.map((skill) => skill.name)).toEqual([
			"alpha-a",
			"alpha-b",
			"alpha-d",
			"alpha-e",
			"alpha-f",
		])
	})

	test("applies disables per call on top of the shared cache", () => {
		//#given
		installCore()
		installAlpha()

		//#when
		const filtered = loadInstalledPacks({ root, disabledPacks: [ALPHA_ID] })
		const full = loadInstalledPacks({ root })

		//#then
		expect(filtered).toHaveLength(1)
		expect(full).toHaveLength(7)
	})

	test("returns an empty array for a missing root", () => {
		//#when
		const skills = loadInstalledPacks({ root: join(root, "missing") })

		//#then
		expect(skills).toEqual([])
	})

	test("returns an empty array when no packs are installed", () => {
		//#when
		const skills = loadInstalledPacks({ root })

		//#then
		expect(skills).toEqual([])
	})

	test("reuses the cache until a lockfile mtime changes", () => {
		//#given
		const core = installCore()
		const lockPath = join(core.dir, PACK_LOCK_FILENAME)
		expect(loadInstalledPacks({ root })[0]?.description).toBe("Core design intelligence")
		writeSkill(core.dir, CORE_ID, { description: "Changed on disk" })

		//#when: SKILL.md changed but no lock mtime bump
		const cached = loadInstalledPacks({ root })

		//#then
		expect(cached[0]?.description).toBe("Core design intelligence")

		//#when: the installer rewrites the lock after replacing files
		const future = new Date(Date.now() + 60_000)
		utimesSync(lockPath, future, future)
		const refreshed = loadInstalledPacks({ root })

		//#then
		expect(refreshed[0]?.description).toBe("Changed on disk")
	})

	test("invalidatePackCache forces a reload", () => {
		//#given
		const core = installCore()
		expect(loadInstalledPacks({ root })[0]?.description).toBe("Core design intelligence")
		writeSkill(core.dir, CORE_ID, { description: "Changed after invalidate" })

		//#when
		invalidatePackCache()
		const skills = loadInstalledPacks({ root })

		//#then
		expect(skills[0]?.description).toBe("Changed after invalidate")
	})
})

describe("resolveCorePackRoot", () => {
	test("returns the installed core skill directory", () => {
		//#given
		const core = installCore()

		//#when
		const dir = resolveCorePackRoot(undefined, root)

		//#then
		expect(dir).toBe(core.skillDir)
	})

	test("returns undefined when the core pack is not installed", () => {
		//#given
		installAlpha()

		//#when
		const dir = resolveCorePackRoot(undefined, root)

		//#then
		expect(dir).toBeUndefined()
	})

	test("selects the most recent installed version", () => {
		//#given
		installCore("1.0.0")
		const latest = installCore("2.0.0")

		//#when
		const dir = resolveCorePackRoot(undefined, root)

		//#then
		expect(dir).toBe(latest.skillDir)
	})

	test("resolves an explicit pack id", () => {
		//#given
		const alpha = installAlpha()

		//#when
		const dir = resolveCorePackRoot(ALPHA_ID, root)

		//#then
		expect(dir).toBe(join(alpha.dir, "skills", ALPHA_ID))
	})
})
