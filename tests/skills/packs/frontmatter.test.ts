import { describe, expect, test } from "bun:test"
import {
	assertSafeSkillName,
	CONTROL_TOKENS,
	DEFAULT_MAX_PACK_TEMPLATE_BYTES,
	isSafeSkillName,
	parseSkillFrontmatter,
	sanitizePackTemplate,
	UnsafeSkillNameError,
} from "../../../src/skills/packs/frontmatter"

describe("parseSkillFrontmatter", () => {
	test("parses quoted values containing a colon", () => {
		//#given
		const raw = [
			"---",
			"name: ui-ux-pro-max",
			'description: "Build: fast, ship: pretty"',
			"license: MIT",
			"---",
			"# Body",
			"content",
		].join("\n")

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed).not.toBeNull()
		expect(parsed?.name).toBe("ui-ux-pro-max")
		expect(parsed?.description).toBe("Build: fast, ship: pretty")
		expect(parsed?.license).toBe("MIT")
		expect(parsed?.body).toBe("# Body\ncontent")
	})

	test("ignores nested metadata blocks and parses top-level allowlisted keys", () => {
		//#given
		const raw = [
			"---",
			"name: design-system",
			"description: Design tokens",
			"metadata:",
			"  author: upstream",
			"  version: 2.15.0",
			'argument-hint: "[query]"',
			"compatibility: opencode",
			"---",
			"Body text",
		].join("\n")

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed).not.toBeNull()
		expect(parsed?.name).toBe("design-system")
		expect(parsed?.description).toBe("Design tokens")
		expect(parsed?.argumentHint).toBe("[query]")
		expect(parsed?.compatibility).toBe("opencode")
		expect(parsed).not.toHaveProperty("metadata")
		expect(parsed).not.toHaveProperty("author")
	})

	test("tolerates unknown top-level keys and strips single quotes", () => {
		//#given
		const raw = [
			"---",
			"name: brand",
			"description: 'Brand: guidelines'",
			"unknown_key: ignored",
			"x-extends: /etc/passwd",
			"---",
			"",
		].join("\n")

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed).not.toBeNull()
		expect(parsed?.description).toBe("Brand: guidelines")
		expect(parsed).not.toHaveProperty("unknown_key")
		expect(parsed).not.toHaveProperty("x-extends")
	})

	test("trims unquoted scalar values", () => {
		//#given
		const raw = ["---", "name:   slides   ", "description:   Decks   ", "---", "body"].join("\n")

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed?.name).toBe("slides")
		expect(parsed?.description).toBe("Decks")
	})

	test("returns null when the leading --- block is missing", () => {
		//#given
		const raw = "name: nope\ndescription: no frontmatter"

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed).toBeNull()
	})

	test("returns null when the frontmatter block is unterminated", () => {
		//#given
		const raw = ["---", "name: broken", "description: never closes"].join("\n")

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed).toBeNull()
	})

	test("returns null when required fields are missing", () => {
		//#given
		const noName = ["---", "description: only a description", "---", ""].join("\n")
		const noDescription = ["---", "name: only-a-name", "---", ""].join("\n")

		//#when / #then
		expect(parseSkillFrontmatter(noName)).toBeNull()
		expect(parseSkillFrontmatter(noDescription)).toBeNull()
	})

	test("tolerates CRLF line endings and a leading BOM", () => {
		//#given
		const raw = ["\uFEFF---", "name: crlf-skill", "description: Handles CRLF", "---", "body"].join(
			"\r\n"
		)

		//#when
		const parsed = parseSkillFrontmatter(raw)

		//#then
		expect(parsed?.name).toBe("crlf-skill")
		expect(parsed?.description).toBe("Handles CRLF")
		expect(parsed?.body).toBe("body")
	})
})

describe("sanitizePackTemplate", () => {
	test("strips ANSI escape sequences", () => {
		//#given
		const input = "\u001b[31mred\u001b[0m text and \u001b]0;title\u0007visible"

		//#when
		const sanitized = sanitizePackTemplate(input)

		//#then
		expect(sanitized).toBe("red text and visible")
	})

	test("strips every known control token", () => {
		//#given
		const tokens = [
			"<tool_use>",
			"</tool_use>",
			"<|im_start|>",
			"<|im_end|>",
			"</s>",
			"[INST]",
			"[/INST]",
		]

		//#then
		expect([...CONTROL_TOKENS]).toEqual(tokens)
		for (const token of tokens) {
			//#when
			const sanitized = sanitizePackTemplate(`before ${token} after`)

			//#then
			expect(sanitized).toBe("before  after")
		}
	})

	test("replaces CLAUDE_PLUGIN_ROOT only when coreSkillRoot is provided", () => {
		//#given
		const input = "python CLAUDE_PLUGIN_ROOT/scripts/search.py"
		const coreSkillRoot = "/opt/matrixx/skill-packs/ui-ux-pro-max"

		//#when
		const replaced = sanitizePackTemplate(input, { coreSkillRoot })
		const untouched = sanitizePackTemplate(input)

		//#then
		expect(replaced).toBe(`python ${coreSkillRoot}/scripts/search.py`)
		expect(untouched).toBe(input)
	})

	test("leaves small templates unchanged", () => {
		//#given
		const input = "# Skill\n\nShort template."

		//#when
		const sanitized = sanitizePackTemplate(input)

		//#then
		expect(sanitized).toBe(input)
	})

	test("truncates 300 KB templates with a marker", () => {
		//#given
		const input = "a".repeat(300 * 1024)

		//#when
		const sanitized = sanitizePackTemplate(input)

		//#then
		expect(sanitized.length).toBeLessThan(input.length)
		expect(sanitized.startsWith("a")).toBe(true)
		expect(sanitized.endsWith(`[truncated: skill template exceeded ${DEFAULT_MAX_PACK_TEMPLATE_BYTES} bytes]`)).toBe(true)
		expect(DEFAULT_MAX_PACK_TEMPLATE_BYTES).toBe(262144)
	})

	test("honours a custom maxBytes option and numeric overload", () => {
		//#given
		const input = "abcdef"

		//#when
		const withOptions = sanitizePackTemplate(input, { maxBytes: 3 })
		const withNumber = sanitizePackTemplate(input, 3)

		//#then
		const marker = "\n[truncated: skill template exceeded 3 bytes]"
		expect(withOptions).toBe(`abc${marker}`)
		expect(withNumber).toBe(`abc${marker}`)
	})
})

describe("assertSafeSkillName", () => {
	test("accepts lowercase kebab-case names", () => {
		//#given
		const names = ["ui-ux-pro-max", "a", "a1-b2", "design-system"]

		//#when / #then
		for (const name of names) {
			expect(() => assertSafeSkillName(name)).not.toThrow()
			expect(isSafeSkillName(name)).toBe(true)
		}
	})

	test("rejects traversal, absolute paths, uppercase, underscores, and empty names", () => {
		//#given
		const names = ["../x", "../../etc/passwd", "/tmp/skill", "Foo", "foo_bar", "", "-leading", ".hidden", "a b"]

		//#when / #then
		for (const name of names) {
			expect(() => assertSafeSkillName(name)).toThrow(UnsafeSkillNameError)
			expect(isSafeSkillName(name)).toBe(false)
		}
	})

	test("throws a typed error with a stable code", () => {
		//#given
		const name = "../x"

		//#when
		try {
			assertSafeSkillName(name)
			throw new Error("expected assertSafeSkillName to throw")
		} catch (error) {
			//#then
			expect(error).toBeInstanceOf(UnsafeSkillNameError)
			expect((error as UnsafeSkillNameError).code).toBe("UNSAFE_SKILL_NAME")
			expect((error as UnsafeSkillNameError).skillName).toBe(name)
		}
	})

	test("isSafeSkillName rejects non-strings", () => {
		//#given
		const values = [42, null, undefined, {}]

		//#when / #then
		for (const value of values) {
			expect(isSafeSkillName(value)).toBe(false)
		}
	})
})
