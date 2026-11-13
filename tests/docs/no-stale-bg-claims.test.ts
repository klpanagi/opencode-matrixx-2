/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "../..")
const DOCS_ROOT = join(REPO_ROOT, "docs")
const BACKGROUND_AGENTS = "src/features/background-agent/AGENTS.md"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".matrixx", ".tmp"])

/**
 * Return human-readable violations for one document. The checks are intentionally
 * line-scoped so an alias may appear as long as the same line also says "deprecated".
 */
export function findStaleClaims(relPath: string, text: string): string[] {
	const violations: string[] = []
	const lines = text.split("\n")

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? ""
		const where = `${relPath}:${index + 1}`

		if (/concurrency\s+slot/i.test(line)) {
			violations.push(`${where}: live "concurrency slot" claim`)
		}
		if (/\bjob[\s-]+boards?\b/i.test(line)) {
			violations.push(`${where}: live "job board" claim`)
		}
		if (/\bwake[\s-]+schedulers?\b/i.test(line)) {
			violations.push(`${where}: live "wake scheduler" claim`)
		}
		if (/output guard prevents zombie tasks/i.test(line)) {
			violations.push(`${where}: "output guard prevents zombie tasks" claim`)
		}
		if (/unstable-agent-babysitter/i.test(line) && !/\bdeprecated\b/i.test(line)) {
			violations.push(`${where}: "unstable-agent-babysitter" named without a same-line "deprecated" marker`)
		}
		if (/background\s*=\s*(<br\/?>)?(true|false)/.test(line)) {
			violations.push(`${where}: live "background=<bool>" argument claim`)
		}
		if (/run_in_background/.test(line)) {
			violations.push(`${where}: live "run_in_background" argument`)
		}
		if (/\bsync inline\b/i.test(line)) {
			violations.push(`${where}: live "sync inline" delegation claim`)
		}
		if (/defaults?\s+to\s+false/i.test(line) && /background/i.test(line)) {
			violations.push(`${where}: background argument "defaults to false" claim`)
		}
	}

	if (relPath === BACKGROUND_AGENTS && /session-output/.test(text)) {
		violations.push(`${relPath}: mentions "session-output" (module deleted, mechanism removed)`)
	}

	return violations
}

function walkMarkdownFiles(root: string): string[] {
	const found: string[] = []

	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue
		const absolute = join(root, entry.name)
		if (entry.isDirectory()) {
			found.push(...walkMarkdownFiles(absolute))
		} else if (entry.isFile() && entry.name === "AGENTS.md") {
			found.push(absolute)
		}
	}

	return found
}

function walkDocs(root: string): string[] {
	if (!existsSync(root)) return []
	const found: string[] = []

	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const absolute = join(root, entry.name)
		if (entry.isDirectory()) {
			found.push(...walkDocs(absolute))
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			found.push(absolute)
		}
	}

	return found
}

function relativeToRepo(absolute: string): string {
	return absolute.slice(REPO_ROOT.length + 1)
}

describe("background-agent docs drift guard", () => {
	test("every AGENTS.md and docs markdown file is free of stale claims", () => {
		//#given
		const scanned = [...walkMarkdownFiles(REPO_ROOT), ...walkDocs(DOCS_ROOT)]
		expect(scanned.length).toBeGreaterThan(0)

		//#when
		const violations = scanned.flatMap((file) =>
			findStaleClaims(relativeToRepo(file), readFileSync(file, "utf8")),
		)

		//#then
		expect(violations).toEqual([])
	})

	test("flags each forbidden live-mechanism claim", () => {
		//#given
		const text = [
			"Uses a concurrency slot per provider.",
			"The Job Board surfaces snapshots.",
			"The wake scheduler nudges idle parents.",
			"The output guard prevents zombie tasks from lingering.",
		].join("\n")

		//#when
		const violations = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(violations).toHaveLength(4)
	})

	test("allows queue-saturated and output guard as an accurate mechanism", () => {
		//#given
		const text = [
			"`queue-saturated` is retained as a compatibility terminal reason.",
			"The output guard confirms the assistant produced terminal output.",
		].join("\n")

		//#when
		const violations = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(violations).toEqual([])
	})

	test("allows unstable-agent-babysitter only when the same line marks it deprecated", () => {
		//#given
		const deprecatedLine = "`unstable-agent-babysitter` — deprecated alias; implementation removed."
		const liveLine = "`unstable-agent-babysitter` monitors unstable behaviour."

		//#when
		const deprecatedViolations = findStaleClaims("src/AGENTS.md", deprecatedLine)
		const liveViolations = findStaleClaims("src/AGENTS.md", liveLine)

		//#then
		expect(deprecatedViolations).toEqual([])
		expect(liveViolations).toHaveLength(1)
	})

	test("flags session-output only in the background-agent AGENTS.md", () => {
		//#given
		const text = "session-output.ts validates output."

		//#when
		const inBackgroundAgents = findStaleClaims(BACKGROUND_AGENTS, text)
		const elsewhere = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(inBackgroundAgents).toHaveLength(1)
		expect(elsewhere).toEqual([])
	})

	test("the deleted session-output module is absent from the tree", () => {
		//#given
		const deletedModule = join(REPO_ROOT, "src/features/background-agent/session-output.ts")

		//#when
		const stillPresent = existsSync(deletedModule)

		//#then
		expect(stillPresent).toBe(false)
	})

	test("flags a background=<boolean> argument mention", () => {
		//#given
		const text = [
			"Pass `background = true` to detach the child.",
			"Set `background=false` to wait for the result.",
			"Row: `background=<br/>true` detaches.",
		].join("\n")

		//#when
		const violations = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(violations).toHaveLength(3)
	})

	test("flags a run_in_background argument mention", () => {
		//#given
		const text = "Call the tool with `run_in_background: true`."

		//#when
		const violations = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(violations).toHaveLength(1)
	})

	test("flags a sync inline claim regardless of case", () => {
		//#given
		const text = "Delegation runs SYNC INLINE and blocks the parent."

		//#when
		const violations = findStaleClaims("docs/fixture.md", text)

		//#then
		expect(violations).toHaveLength(1)
	})

	test("flags defaults-to-false only when the same line mentions background", () => {
		//#given
		const backgroundText = "The `background` flag defaults to false."
		const otherKeyText = "The `session_scoped` key defaults to false."

		//#when
		const backgroundViolations = findStaleClaims("docs/fixture.md", backgroundText)
		const otherKeyViolations = findStaleClaims("docs/fixture.md", otherKeyText)

		//#then
		expect(backgroundViolations).toHaveLength(1)
		expect(otherKeyViolations).toEqual([])
	})

	test("allows a bare defaults-to-false sentence and a Gherkin background row", () => {
		//#given
		const bare = "This option defaults to false."
		const gherkinRow = "| `background` | `Background?` | Shared background steps (Gherkin `Background:`) |"

		//#when
		const bareViolations = findStaleClaims("docs/fixture.md", bare)
		const gherkinViolations = findStaleClaims("docs/fixture.md", gherkinRow)

		//#then
		expect(bareViolations).toEqual([])
		expect(gherkinViolations).toEqual([])
	})
})
