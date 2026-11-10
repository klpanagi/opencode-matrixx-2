export interface PlanTaskEffortShape {
	total?: unknown
	tokenUsd?: unknown
	computedAt?: unknown
}

export interface PlanTaskEffortInput {
	taskId: string
	effort?: PlanTaskEffortShape | null
	generation?: unknown
	computedAt?: unknown
}

export interface PlanEffortRollup {
	total: number
	tokenUsd: number
	taskCount: number
	computedAt: string
}

function finiteOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

function validIso(value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0) return null
	const time = Date.parse(value)
	return Number.isFinite(time) ? value : null
}

function safeSum(values: number[]): number {
	let sum = 0
	for (const value of values) {
		sum += value
		if (!Number.isFinite(sum)) return 0
	}
	return sum
}

export function collectPlanEffort(inputs: PlanTaskEffortInput[]): PlanEffortRollup {
	try {
		const list = Array.isArray(inputs) ? inputs : []
		const totals: number[] = []
		const tokenUsds: number[] = []
		let taskCount = 0
		let latest: string | null = null

		for (const input of list) {
			if (input === null || typeof input !== "object") continue
			const effort = input.effort
			const shape: PlanTaskEffortShape =
				effort !== null && typeof effort === "object" ? (effort as PlanTaskEffortShape) : {}
			const total = finiteOrNull(shape.total)
			if (total === null) continue
			taskCount += 1
			totals.push(total)
			tokenUsds.push(finiteOrZero(shape.tokenUsd))
			const stamped = validIso(shape.computedAt) ?? validIso(input.computedAt)
			if (stamped !== null && (latest === null || stamped > latest)) {
				latest = stamped
			}
		}

		return {
			total: safeSum(totals),
			tokenUsd: safeSum(tokenUsds),
			taskCount,
			computedAt: latest ?? new Date().toISOString(),
		}
	} catch {
		return { total: 0, tokenUsd: 0, taskCount: 0, computedAt: new Date().toISOString() }
	}
}
