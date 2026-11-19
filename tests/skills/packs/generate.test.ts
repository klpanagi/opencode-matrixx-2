import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
	DEFAULT_CORE_SKILL_PLATFORM,
	type CoreSkillPlatform,
	generateCoreSkill,
	materializeAuxSkills,
	renderFrontmatter,
	UnresolvedPlaceholderError,
} from "../../../src/cli/skill-pack/generate"
import { parseSkillFrontmatter } from "../../../src/skills/packs/frontmatter"

const tempRoots: string[] = []

afterEach(() => {
	for (let root = tempRoots.pop(); root !== undefined; root = tempRoots.pop()) {
		rmSync(root, { recursive: true, force: true })
	}
})

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "matrixx-generate-"))
	tempRoots.push(dir)
	return dir
}

function write(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content, "utf-8")
}

const BASE_TEMPLATE = [
	"# {{TITLE}}",
	"",
	"{{DESCRIPTION}}",
	"",
	"Run: python3 {{SCRIPT_PATH}} --domain colors",
	"Again: {{SCRIPT_PATH}}",
	"",
	"Type: {{SKILL_OR_WORKFLOW}}",
	"{{QUICK_REFERENCE}}",
].join("\n")

const OPENCODE_PLATFORM: CoreSkillPlatform = {
	root: ".opencode",
	skillPath: "skills/ui-ux-pro-max",
	filename: "SKILL.md",
	scriptPath: "skills/ui-ux-pro-max/scripts/search.py",
	sections: { quickReference: false },
	title: "ui-ux-pro-max",
	skillOrWorkflow: "Skill",
	frontmatter: {
		name: "ui-ux-pro-max",
		description: "Build: fast, ship: pretty",
	},
}

interface AssetsFixture {
	root: string
	assetsDir: string
}

function makeAssets(options: { platform?: boolean } = {}): AssetsFixture {
	const root = tempDir()
	const assetsDir = join(root, "assets")

	write(join(assetsDir, "templates/base/skill-content.md"), BASE_TEMPLATE)
	write(join(assetsDir, "templates/base/quick-reference.md"), "## Quick Reference\nQUICK-REFERENCE-MARKER")
	write(join(assetsDir, "data/colors/colors.csv"), "name,hex\nteal,#008080")
	write(join(assetsDir, "scripts/search.py"), "print('search')")
	write(join(assetsDir, "scripts/design_system.py"), "print('ds')")
	write(join(assetsDir, "scripts/tests/test_search.py"), "def test_search(): pass")

	write(join(assetsDir, "skills/design-system/SKILL.md"), "---\nname: design-system\ndescription: Tokens\n---\nDS body")
	write(join(assetsDir, "skills/design-system/references/tokens.md"), "# Tokens")
	write(join(assetsDir, "skills/design-system/scripts/run.py"), "print('aux')")
	write(join(assetsDir, "skills/design-system/scripts/tests/test_run.py"), "def test_run(): pass")
	write(join(assetsDir, "skills/brand/SKILL.md"), "---\nname: brand\ndescription: Brand\n---\nBRAND")
	write(join(assetsDir, "skills/ui-ux-pro-max/SKILL.md"), "CORE SKILL.md IS NOT SHIPPED")
	write(join(assetsDir, "skills/ui-ux-pro-max/scripts/search.py"), "CORE SCRIPT IS COPIED FROM assets/scripts")

	if (options.platform !== false) {
		write(join(root, "platforms/opencode.json"), JSON.stringify(OPENCODE_PLATFORM, null, 2))
	}

	return { root, assetsDir }
}

function generate(fixture: AssetsFixture, scriptPathAbsolute: string, platform?: CoreSkillPlatform) {
	const coreSkillRoot = join(fixture.root, "installed/ui-ux-pro-max")
	return generateCoreSkill({
		assetsDir: fixture.assetsDir,
		coreSkillRoot,
		scriptPathAbsolute,
		...(platform !== undefined ? { platform } : {}),
	})
}

describe("generateCoreSkill", () => {
	test("renders every placeholder and keeps an absolute script path", () => {
		//#given a pack assets tree carrying platforms/opencode.json
		const fixture = makeAssets()
		const scriptPathAbsolute = join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py")

		//#when the core skill is generated
		const result = generate(fixture, scriptPathAbsolute)

		//#then no template placeholder survives
		expect(result.content).not.toContain("{{")
		expect(result.content).not.toContain("}}")

		//#and the five substitutions landed in the document
		expect(result.content).toContain("# ui-ux-pro-max")
		expect(result.content).toContain("Build: fast, ship: pretty")
		expect(result.content).toContain(`Run: python3 ${scriptPathAbsolute} --domain colors`)
		expect(result.content).toContain(`Again: ${scriptPathAbsolute}`)
		expect(result.content).toContain("Type: Skill")
		expect(result.content).not.toContain("QUICK-REFERENCE-MARKER")
		expect(result.scriptPath).toBe(scriptPathAbsolute)

		//#and the generated frontmatter parses with the pack name
		const parsed = parseSkillFrontmatter(result.content)
		expect(parsed?.name).toBe("ui-ux-pro-max")
		expect(parsed?.description).toBe("Build: fast, ship: pretty")
		expect(parsed?.body).toContain("# ui-ux-pro-max")

		//#and SKILL.md was written under the core skill root
		expect(result.skillFile).toBe(join(fixture.root, "installed/ui-ux-pro-max/SKILL.md"))
		expect(existsSync(result.skillFile)).toBe(true)
		expect(readFileSync(result.skillFile, "utf-8")).toBe(result.content)
	})

	test("falls back to the documented opencode platform when no config is shipped", () => {
		//#given assets without platforms/opencode.json
		const fixture = makeAssets({ platform: false })
		const scriptPathAbsolute = join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py")

		//#when the core skill is generated
		const result = generate(fixture, scriptPathAbsolute)

		//#then the default platform supplies the title and skill kind
		expect(result.content).toContain("# ui-ux-pro-max")
		expect(result.content).toContain("Type: Skill")
		expect(result.content).toContain(DEFAULT_CORE_SKILL_PLATFORM.frontmatter.description)
		expect(result.content).not.toContain("QUICK-REFERENCE-MARKER")
		expect(result.content).not.toContain("{{")
	})

	test("inserts the quick reference block only when sections.quickReference is true", () => {
		//#given a platform that enables the quick reference section
		const fixture = makeAssets({ platform: false })
		const platform: CoreSkillPlatform = {
			...DEFAULT_CORE_SKILL_PLATFORM,
			sections: { quickReference: true },
		}

		//#when generated
		const result = generate(fixture, join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py"), platform)

		//#then the quick reference content is inlined behind a newline
		expect(result.content).toContain("\n## Quick Reference\nQUICK-REFERENCE-MARKER")
		expect(result.content).not.toContain("{{QUICK_REFERENCE}}")
	})

	test("prefers the absolute script path over the platform relative path", () => {
		//#given a platform whose configured path is project-relative
		const fixture = makeAssets({ platform: false })
		const platform: CoreSkillPlatform = {
			...DEFAULT_CORE_SKILL_PLATFORM,
			root: "custom-root",
			scriptPath: "custom/script.py",
		}
		const scriptPathAbsolute = "/opt/matrixx/skill-packs/ui-ux-pro-max/scripts/search.py"

		//#when generated
		const result = generate(fixture, scriptPathAbsolute, platform)

		//#then the absolute path is used and the relative one never appears
		expect(result.content).toContain(`Run: python3 ${scriptPathAbsolute}`)
		expect(result.content).not.toContain("custom-root/custom/script.py")
	})

	test("copies data and scripts into the core skill root, excluding scripts/tests", () => {
		//#given a pack assets tree with test scripts
		const fixture = makeAssets()

		//#when generated
		const result = generate(fixture, join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py"))
		const coreSkillRoot = join(fixture.root, "installed/ui-ux-pro-max")

		//#then data and scripts are present
		expect(existsSync(join(coreSkillRoot, "data/colors/colors.csv"))).toBe(true)
		expect(existsSync(join(coreSkillRoot, "scripts/search.py"))).toBe(true)
		expect(existsSync(join(coreSkillRoot, "scripts/design_system.py"))).toBe(true)

		//#and pytest files are not copied
		expect(existsSync(join(coreSkillRoot, "scripts/tests/test_search.py"))).toBe(false)

		//#and the copied files are reported
		expect(result.files).toContain(join(coreSkillRoot, "scripts/search.py"))
		expect(result.files).toContain(join(coreSkillRoot, "data/colors/colors.csv"))
	})

	test("substitutes CLAUDE_PLUGIN_ROOT with the core skill root", () => {
		//#given a base template that still references the Claude plugin root
		const fixture = makeAssets({ platform: false })
		write(
			join(fixture.assetsDir, "templates/base/skill-content.md"),
			`${BASE_TEMPLATE}\nLook in CLAUDE_PLUGIN_ROOT/scripts/search.py`,
		)
		const scriptPathAbsolute = join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py")

		//#when generated
		const result = generate(fixture, scriptPathAbsolute)

		//#then the token is replaced by the absolute core root
		const coreSkillRoot = join(fixture.root, "installed/ui-ux-pro-max")
		expect(result.content).toContain(`${coreSkillRoot}/scripts/search.py`)
		expect(result.content).not.toContain("CLAUDE_PLUGIN_ROOT")
	})

	test("throws when an unknown placeholder survives generation", () => {
		//#given a template with a placeholder the algorithm does not know
		const fixture = makeAssets({ platform: false })
		write(
			join(fixture.assetsDir, "templates/base/skill-content.md"),
			`${BASE_TEMPLATE}\n{{UNKNOWN_TOKEN}}`,
		)

		//#when generated
		//#then the unresolved placeholder is rejected instead of shipped
		expect(() => generate(fixture, join(fixture.root, "installed/ui-ux-pro-max/scripts/search.py"))).toThrow(
			UnresolvedPlaceholderError,
		)
	})
})

describe("materializeAuxSkills", () => {
	test("copies every aux skill verbatim except the core pack", () => {
		//#given extracted assets/skills
		const fixture = makeAssets()
		const destSkillsDir = join(fixture.root, "installed/ui-ux-pro-max/skills")

		//#when aux skills are materialized
		const result = materializeAuxSkills({
			assetsSkillsDir: join(fixture.assetsDir, "skills"),
			destSkillsDir,
		})

		//#then only non-core directories are reported
		expect(result.skills.sort()).toEqual(["brand", "design-system"])
		expect(existsSync(join(destSkillsDir, "ui-ux-pro-max"))).toBe(false)

		//#and their files are copied byte for byte
		expect(readFileSync(join(destSkillsDir, "design-system/SKILL.md"), "utf-8")).toBe(
			"---\nname: design-system\ndescription: Tokens\n---\nDS body",
		)
		expect(readFileSync(join(destSkillsDir, "design-system/references/tokens.md"), "utf-8")).toBe("# Tokens")
		expect(existsSync(join(destSkillsDir, "brand/SKILL.md"))).toBe(true)

		//#and scripts/tests is excluded everywhere
		expect(existsSync(join(destSkillsDir, "design-system/scripts/run.py"))).toBe(true)
		expect(existsSync(join(destSkillsDir, "design-system/scripts/tests/test_run.py"))).toBe(false)

		//#and copied file paths are reported
		expect(result.files).toContain(join(destSkillsDir, "design-system/SKILL.md"))
		expect(result.files).not.toContain(join(destSkillsDir, "design-system/scripts/tests/test_run.py"))
	})

	test("honours explicit exclusions", () => {
		//#given extracted assets/skills
		const fixture = makeAssets()
		const destSkillsDir = join(fixture.root, "installed/ui-ux-pro-max/skills")

		//#when brand is excluded
		const result = materializeAuxSkills({
			assetsSkillsDir: join(fixture.assetsDir, "skills"),
			destSkillsDir,
			excludeSkills: ["brand"],
		})

		//#then only design-system remains
		expect(result.skills).toEqual(["design-system"])
		expect(existsSync(join(destSkillsDir, "brand"))).toBe(false)
	})

	test("returns an empty result when there is no aux skills directory", () => {
		//#given a pack without assets/skills
		const root = tempDir()

		//#when materialized
		const result = materializeAuxSkills({
			assetsSkillsDir: join(root, "missing"),
			destSkillsDir: join(root, "out"),
		})

		//#then nothing is reported and no destination is created
		expect(result).toEqual({ skills: [], files: [] })
	})
})

describe("renderFrontmatter", () => {
	test("leaves plain scalars unquoted", () => {
		//#given a plain name and description
		//#when rendered
		const rendered = renderFrontmatter({ name: "ui-ux-pro-max", description: "Plain description" })

		//#then the document uses the documented layout
		expect(rendered).toBe("---\nname: ui-ux-pro-max\ndescription: Plain description\n---\n")
	})

	test("quotes and escapes values containing yaml-significant characters", () => {
		//#given a description containing a colon and a double quote
		//#when rendered
		const rendered = renderFrontmatter({ name: "ui-ux-pro-max", description: 'He said: "hi"' })

		//#then the value is quoted and the quote is escaped
		expect(rendered).toBe('---\nname: ui-ux-pro-max\ndescription: "He said: \\"hi\\""\n---\n')
	})
})
