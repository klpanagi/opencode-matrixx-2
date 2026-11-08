import type { EffortRecord } from "./types"

export interface EffortRollupEntry {
	sessionID: string
	generation: number
	record: EffortRecord
}

export interface EffortRollupChild {
	sessionID: string
	generation: number
	total: number
	tokenUsd: number
	computedAt: string
}

export interface EffortRollup {
	total: number
	tokenUsd: number
	childCount: number
	children: EffortRollupChild[]
}

/** Gate helper: rollup is opt-in. */
export function shouldRollup(config: { rollup: boolean }): boolean {
	return config.rollup === true
}

function finiteOrZero(value: number): number {
	return Number.isFinite(value) ? value : 0
}

function compareChildren(a: EffortRollupChild, b: EffortRollupChild): number {
	if (a.sessionID !== b.sessionID) {
		return a.sessionID < b.sessionID ? -1 : 1
	}
	return a.generation - b.generation
}

function safeSum(values: number[]): number {
	let sum = 0
	for (const value of values) {
		sum += value
		if (!Number.isFinite(sum)) return 0
	}
	return sum
}

/**
 * Dedupe by `${sessionID}:${generation}` keeping the entry with the latest
 * computedAt, then sum. Non-finite child values are sanitized to 0 so the
 * aggregate stays finite; the child is still reported.
 */
export function rollupEffort(entries: EffortRollupEntry[]): EffortRollup {
	const deduped = new Map<string, EffortRollupChild>()

	for (const entry of entries) {
		const key = `${entry.sessionID}:${entry.generation}`
		const child: EffortRollupChild = {
			sessionID: entry.sessionID,
			generation: entry.generation,
			total: finiteOrZero(entry.record.total),
			tokenUsd: finiteOrZero(entry.record.tokenUsd),
			computedAt: entry.record.computedAt,
		}
		const existing = deduped.get(key)
		if (!existing || child.computedAt > existing.computedAt) {
			deduped.set(key, child)
		}
	}

	const children = [...deduped.values()].sort(compareChildren)
	const total = safeSum(children.map((child) => child.total))
	const tokenUsd = safeSum(children.map((child) => child.tokenUsd))

	return {
		total,
		tokenUsd,
		childCount: children.length,
		children,
	}
}
