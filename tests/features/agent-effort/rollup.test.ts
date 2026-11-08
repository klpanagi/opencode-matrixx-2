/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { EffortRecord } from "../../../src/features/agent-effort/types"
import {
	type EffortRollupEntry,
	rollupEffort,
	shouldRollup,
} from "../../../src/features/agent-effort/rollup"

function buildRecord(overrides?: Partial<EffortRecord>): EffortRecord {
	return {
		formulaVersion: 1,
		total: 1,
		tokenUsd: 0.001,
		components: {
			computeUnits: 1,
			actionUnits: 1,
			epistemicUnits: 1,
			coordUnits: 1,
			tokenUsd: 0.001,
			total: 1,
		},
		telemetry: {
			input: 100,
			output: 200,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
			steps: 1,
			toolCalls: 1,
			uniqueTools: 1,
			retries: 0,
			durationMs: 1000,
		},
		coverage: "full",
		missing: [],
		computedAt: "2026-11-08T00:00:00.000Z",
		...overrides,
	}
}

function entry(
	sessionID: string,
	generation: number,
	overrides?: Partial<EffortRecord>,
): EffortRollupEntry {
	return { sessionID, generation, record: buildRecord(overrides) }
}

describe("shouldRollup", () => {
	test("returns true only when rollup is explicitly true", () => {
		//#given
		const enabled = { rollup: true }
		const disabled = { rollup: false }

		//#when
		const whenEnabled = shouldRollup(enabled)
		const whenDisabled = shouldRollup(disabled)

		//#then
		expect(whenEnabled).toBe(true)
		expect(whenDisabled).toBe(false)
	})
})

describe("rollupEffort", () => {
	test("returns zeros and no children for an empty entry list", () => {
		//#given
		const entries: EffortRollupEntry[] = []

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.total).toBe(0)
		expect(result.tokenUsd).toBe(0)
		expect(result.childCount).toBe(0)
		expect(result.children).toEqual([])
	})

	test("sums distinct session children", () => {
		//#given
		const entries = [
			entry("ses_a", 1, { total: 2.5, tokenUsd: 0.01 }),
			entry("ses_b", 1, { total: 3.5, tokenUsd: 0.02 }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.childCount).toBe(2)
		expect(result.total).toBe(6)
		expect(result.tokenUsd).toBeCloseTo(0.03, 10)
	})

	test("dedupes duplicate (sessionID, generation) keeping latest computedAt", () => {
		//#given
		const entries = [
			entry("ses_a", 1, { total: 5, tokenUsd: 0.05, computedAt: "2026-11-08T00:00:00.000Z" }),
			entry("ses_a", 1, { total: 7, tokenUsd: 0.07, computedAt: "2026-11-08T01:00:00.000Z" }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.childCount).toBe(1)
		expect(result.total).toBe(7)
		expect(result.tokenUsd).toBeCloseTo(0.07, 10)
		expect(result.children[0]?.computedAt).toBe("2026-11-08T01:00:00.000Z")
	})

	test("keeps the first entry when duplicate computedAt ties", () => {
		//#given
		const entries = [
			entry("ses_a", 1, { total: 4, computedAt: "2026-11-08T00:00:00.000Z" }),
			entry("ses_a", 1, { total: 9, computedAt: "2026-11-08T00:00:00.000Z" }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.childCount).toBe(1)
		expect(result.total).toBe(4)
	})

	test("counts the same session at different generations separately", () => {
		//#given
		const entries = [
			entry("ses_a", 1, { total: 2 }),
			entry("ses_a", 2, { total: 3 }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.childCount).toBe(2)
		expect(result.total).toBe(5)
		expect(result.children.map((child) => child.generation)).toEqual([1, 2])
	})

	test("sorts children by sessionID then generation ascending", () => {
		//#given
		const entries = [
			entry("ses_b", 2, { total: 1 }),
			entry("ses_a", 2, { total: 1 }),
			entry("ses_b", 1, { total: 1 }),
			entry("ses_a", 1, { total: 1 }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.children.map((child) => `${child.sessionID}:${child.generation}`)).toEqual([
			"ses_a:1",
			"ses_a:2",
			"ses_b:1",
			"ses_b:2",
		])
	})

	test("sanitizes non-finite child values to zero and keeps the child", () => {
		//#given
		const entries = [
			entry("ses_nan", 1, { total: Number.NaN, tokenUsd: Number.NaN }),
			entry("ses_inf", 1, { total: Number.POSITIVE_INFINITY, tokenUsd: Number.NEGATIVE_INFINITY }),
			entry("ses_ok", 1, { total: 2, tokenUsd: 0.02 }),
		]

		//#when
		const result = rollupEffort(entries)

		//#then
		expect(result.childCount).toBe(3)
		expect(result.total).toBe(2)
		expect(result.tokenUsd).toBeCloseTo(0.02, 10)
		expect(Number.isFinite(result.total)).toBe(true)
		expect(Number.isFinite(result.tokenUsd)).toBe(true)
		expect(result.children.find((child) => child.sessionID === "ses_nan")?.total).toBe(0)
	})

	test("never exceeds a finite total even on repeated calls", () => {
		//#given
		const entries = [
			entry("ses_a", 1, { total: 1.5, tokenUsd: 0.01 }),
			entry("ses_b", 1, { total: 2.25, tokenUsd: 0.02 }),
		]

		//#when
		const first = rollupEffort(entries)
		const second = rollupEffort(entries)

		//#then
		expect(second).toEqual(first)
		expect(Number.isFinite(second.total)).toBe(true)
		expect(Number.isFinite(second.tokenUsd)).toBe(true)
	})
})
