/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { V2Event } from "../../../src/plugin/tool/context"
import { verifyCompletion } from "../../../src/hooks/matrix-loop/completion-verifier"
import { createLoopSessionRecovery } from "../../../src/hooks/matrix-loop/loop-session-recovery"
import { createLoopStateController } from "../../../src/hooks/matrix-loop/loop-state-controller"
import { createMatrixLoopEventHandler } from "../../../src/hooks/matrix-loop/matrix-loop-event-handler"
import type { NativePluginContext } from "../../../src/shared/session/session-context-source"

// Plan `.matrixx/plans/bugs-remediation.md` T11 (bug C4): the verifier fails closed
// on every non-verdict path, and the matrix-loop idle handler bounds the continuation
// prompt so a hung prompt can never hold the in-flight guard forever.

describe("matrix-loop verification timeouts", () => {
	function createVerifierCtx(
		promptImpl: (args: unknown) => Promise<unknown>,
		createResult: unknown = { id: "verify-session-timeout" },
	) {
		return {
			session: {
				create: async () => createResult,
				prompt: promptImpl,
				context: async () => [],
				remove: async () => ({}),
			},
			directory: "/tmp/test",
		} as unknown as NativePluginContext
	}

	//#given the verification prompt rejects
	//#when verifyCompletion is called
	//#then it fails closed with reason "verification_error"
	test("should fail closed with verification_error when the prompt rejects", async () => {
		const ctx = createVerifierCtx(async () => {
			throw new Error("prompt exploded")
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 2,
			timeoutMs: 50,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_error")
	})

	//#given the verification session is created without an id
	//#when verifyCompletion is called
	//#then it fails closed with reason "verification_error"
	//
	// Plan `.matrixx/plans/bugs-remediation.md` T11 (bug C4): a verifier session that
	// cannot be created means verification did not run, so the completion stays
	// unverified instead of being accepted on the fail-open path.
	test("should fail closed with verification_error when the verification session has no id", async () => {
		const ctx = createVerifierCtx(async () => ({}), {})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 2,
			timeoutMs: 50,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_error")
	})
})

describe("matrix-loop in-flight guard", () => {
	const TEST_DIR = join(tmpdir(), `matrix-loop-guard-timeout-${Date.now()}`)
	const PROMPT_BUDGET_MS = 25

	function createOptions() {
		return {
			directory: TEST_DIR,
			apiTimeoutMs: 50,
			getTranscriptPath: () => undefined,
			sessionRecovery: createLoopSessionRecovery(),
			loopState: createLoopStateController({
				directory: TEST_DIR,
				stateDir: undefined,
				config: undefined,
			}),
			promptTimeoutMs: PROMPT_BUDGET_MS,
		}
	}

	function createCtx(promptImpl: (args: unknown) => Promise<unknown>) {
		const calls = { prompt: 0 }
		const ctx = {
			session: {
				prompt: async (args: unknown) => {
					calls.prompt += 1
					return promptImpl(args)
				},
				context: async () => [],
				create: async () => ({ id: "verify-session-guard" }),
				remove: async () => ({}),
			},
			directory: TEST_DIR,
		} as unknown as NativePluginContext
		return { ctx, calls }
	}

	beforeEach(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true })
		}
	})

	afterEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true })
		}
	})

	//#given an active loop whose continuation prompt never resolves
	//#when session.idle fires and the prompt exceeds its dedicated budget
	//#then the in-flight guard is released and the loop stays active
	test(
		"releases the in-flight guard after a prompt timeout and keeps the loop active",
		async () => {
			const { ctx, calls } = createCtx(() => new Promise<never>(() => {}))
			const options = createOptions()
			const handler = createMatrixLoopEventHandler(ctx, options)
			const idle = {
				type: "session.idle",
				data: { sessionID: "session-guard" },
			} as unknown as V2Event

			options.loopState.startLoop("session-guard", "Ship the fix", { maxIterations: 5 })

			const startedAt = Date.now()
			await handler(idle)
			const elapsedMs = Date.now() - startedAt

			//#then the handler returned within the dedicated budget, not the 120s prompt default
			expect(elapsedMs).toBeLessThan(2000)
			expect(calls.prompt).toBe(1)
			const afterTimeout = options.loopState.getState()
			expect(afterTimeout?.active).toBe(true)
			expect(afterTimeout?.iteration).toBe(2)

			//#when a second idle arrives after the guard was released
			await handler(idle)

			//#then the handler runs again instead of skipping as in flight
			expect(calls.prompt).toBe(2)
			const afterSecondIdle = options.loopState.getState()
			expect(afterSecondIdle?.active).toBe(true)
			expect(afterSecondIdle?.iteration).toBe(3)
		},
		3000,
	)
})
