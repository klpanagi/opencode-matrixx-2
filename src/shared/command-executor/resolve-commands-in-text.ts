import { findEmbeddedCommands } from "./embedded-commands"
import { executeCommand } from "./execute-command"
import { BLOCKED_SHELL_EXPANSION_MARKER, type CommandExpansionPolicy, decideExpansion } from "./types"

export interface ResolveCommandsOptions {
	policy?: CommandExpansionPolicy
	execFn?: (command: string) => Promise<string>
	maxDepth?: number
	onBlocked?: (blocked: { match: string; reason: string }) => void
}

export async function resolveCommandsInText(text: string, options: ResolveCommandsOptions = {}): Promise<string> {
	return resolveWithDepth(text, options, 0)
}

async function resolveWithDepth(text: string, options: ResolveCommandsOptions, depth: number): Promise<string> {
	if (depth >= (options.maxDepth ?? 3)) {
		return text
	}

	const matches = findEmbeddedCommands(text)
	if (matches.length === 0) {
		return text
	}

	const decision = decideExpansion(options.policy)

	const tasks = matches.map(async (m) => {
		if (!decision.allowShell) {
			options.onBlocked?.({ match: m.fullMatch, reason: decision.reason ?? BLOCKED_SHELL_EXPANSION_MARKER })
			return BLOCKED_SHELL_EXPANSION_MARKER
		}
		if (options.execFn) {
			return options.execFn(m.command)
		}
		return executeCommand(m.command, { allowShell: true })
	})
	const results = await Promise.allSettled(tasks)

	const replacements = new Map<string, string>()

	matches.forEach((match, idx) => {
		const result = results[idx]
		if (result.status === "rejected") {
			replacements.set(
				match.fullMatch,
				`[error: ${
					result.reason instanceof Error ? result.reason.message : String(result.reason)
				}]`,
			)
		} else {
			replacements.set(match.fullMatch, result.value)
		}
	})

	let resolved = text
	for (const [pattern, replacement] of replacements.entries()) {
		resolved = resolved.split(pattern).join(replacement)
	}

	if (findEmbeddedCommands(resolved).length > 0) {
		return resolveWithDepth(resolved, options, depth + 1)
	}

	return resolved
}
