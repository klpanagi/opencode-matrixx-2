/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxConfig } from "../../../src/config"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import type { SkillContext } from "../../../src/plugin/tool/skill-context"
import { createToolCatalog } from "../../../src/plugin/tool/tool-catalog"
import { shouldEnableUiUxTools } from "../../../src/plugin/tool/tool-policy"

const CORE_PACK_ID = "ui-ux-pro-max"
const CORE_PACK_VERSION = "2.15.0"
const UIUX_TOOLS = ["uiux_search", "uiux_design_system", "uiux_validate"] as const

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "matrixx-uiux-gating-"))
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
})

function installCorePack(packsRoot: string): string {
	const versionDir = join(packsRoot, CORE_PACK_ID, CORE_PACK_VERSION)
	mkdirSync(join(versionDir, "skills", CORE_PACK_ID), { recursive: true })
	writeFileSync(
		join(versionDir, "lock.json"),
		JSON.stringify({
			packId: CORE_PACK_ID,
			version: CORE_PACK_VERSION,
			integrity: "sha512-deadbeef",
			sourceUrl: `https://example.test/${CORE_PACK_ID}.tgz`,
			installedAt: "2026-01-01T00:00:00.000Z",
			files: [],
			skills: [],
			risks: [],
			pythonRequired: true,
		})
	)
	return join(versionDir, "skills", CORE_PACK_ID)
}

function makeArgs(pluginConfig: MatrixxConfig) {
	return {
		ctx: { directory: root, client: {} } as unknown as MatrixxContext,
		pluginConfig,
		skillContext: {
			builtinSkills: [],
			availableSkills: [],
			browserProvider: "playwright",
			disabledSkills: new Set<string>(),
		} as unknown as SkillContext,
		availableCategories: [],
	}
}

function registeredNames(pluginConfig: MatrixxConfig): string[] {
	const { filteredTools } = createToolCatalog(makeArgs(pluginConfig))
	return UIUX_TOOLS.filter((name) => filteredTools[name] !== undefined)
}

describe("shouldEnableUiUxTools", () => {
	test("is false when no core pack root is resolved", () => {
		//#given no resolved core skill root
		//#when evaluating the gate without an override
		//#then registration stays off
		expect(shouldEnableUiUxTools(undefined)).toBe(false)
		expect(shouldEnableUiUxTools(null)).toBe(false)
		expect(shouldEnableUiUxTools("")).toBe(false)
	})

	test("is true when a core pack root is resolved", () => {
		//#given an installed pack's skill root
		//#when evaluating the gate without an override
		//#then registration is enabled
		expect(shouldEnableUiUxTools("/packs/ui-ux-pro-max/2.15.0/skills/ui-ux-pro-max")).toBe(true)
	})

	test("explicit false wins over a resolved root", () => {
		//#given a resolved root and an explicit false override
		//#when evaluating the gate
		//#then the override disables registration
		expect(shouldEnableUiUxTools("/packs/core", false)).toBe(false)
	})

	test("explicit true wins even without a resolved root", () => {
		//#given no resolved root and an explicit true override
		//#when evaluating the gate
		//#then the predicate honours the override (the catalog still needs a root to register)
		expect(shouldEnableUiUxTools(undefined, true)).toBe(true)
	})
})

describe("tool-catalog uiux_* registration", () => {
	test("registers nothing when the core pack is not installed", () => {
		//#given a packs root with no installed packs
		//#when building the tool catalog
		//#then no uiux tools are registered
		expect(registeredNames({ skill_packs: { root } } as MatrixxConfig)).toEqual([])
	})

	test("registers the three tools when the core pack is installed", () => {
		//#given an installed ui-ux-pro-max pack
		installCorePack(root)
		//#when building the tool catalog
		//#then all three uiux tools are registered
		expect(registeredNames({ skill_packs: { root } } as MatrixxConfig)).toEqual([...UIUX_TOOLS])
	})

	test("uiux_tools:false disables registration even with the pack installed", () => {
		//#given an installed pack and an explicit false gate
		installCorePack(root)
		const config = {
			skill_packs: { root },
			tool_gating: { uiux_tools: false },
		} as unknown as MatrixxConfig
		//#when building the tool catalog
		//#then no uiux tools are registered
		expect(registeredNames(config)).toEqual([])
	})

	test("skill_packs.enabled:false disables registration even with the pack installed", () => {
		//#given an installed pack and the skill-pack feature disabled
		installCorePack(root)
		const config = {
			skill_packs: { root, enabled: false },
		} as unknown as MatrixxConfig
		//#when building the tool catalog
		//#then no uiux tools are registered
		expect(registeredNames(config)).toEqual([])
	})

	test("uiux_tools:true without an installed pack registers nothing", () => {
		//#given no installed pack and an explicit true gate
		const config = {
			skill_packs: { root },
			tool_gating: { uiux_tools: true },
		} as unknown as MatrixxConfig
		//#when building the tool catalog
		//#then no uiux tools are registered
		expect(registeredNames(config)).toEqual([])
	})
})
