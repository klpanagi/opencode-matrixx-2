/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { verifyCompletion } from "../../../src/hooks/matrix-loop/completion-verifier"

function createMockCtx(overrides?: {
	createResult?: { data?: { id?: string }; error?: unknown }
	promptResult?: unknown
	messagesResult?: unknown[]
	messagesError?: Error
	createError?: Error
}) {
	const calls = {
		create: [] as unknown[],
		prompt: [] as unknown[],
		messages: [] as unknown[],
	}

	return {
		ctx: {
			session: {
				create: async (opts: unknown) => {
					calls.create.push(opts)
					if (overrides?.createError) throw overrides.createError
					return overrides?.createResult ?? { id: "verify-session-1" }
				},
				prompt: async (opts: unknown) => {
					calls.prompt.push(opts)
					return overrides?.promptResult ?? {}
				},
				context: async (opts: unknown) => {
					calls.messages.push(opts)
					if (overrides?.messagesError) throw overrides.messagesError
					return overrides?.messagesResult ?? []
				},
				remove: async () => {},
			},
			directory: "/tmp/test",
		} as unknown as Parameters<typeof verifyCompletion>[0],
		calls,
	}
}

describe("completion-verifier", () => {
	//#given a completion with valid verification response PASS
	//#when verifyCompletion is called
	//#then it returns { verified: true }
	test("should return verified=true when agent responds with PASS", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ type: "user", content: [{ type: "text", text: "Verify..." }] },
				{
					type: "assistant",
					content: [{ type: "text", text: "Everything looks good. <verification>PASS</verification>" }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	//#given a completion with FAIL verification response
	//#when verifyCompletion is called
	//#then it returns { verified: false, reason: "..." }
	test("should return verified=false with reason when agent responds with FAIL", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ type: "user", content: [{ type: "text", text: "Verify..." }] },
				{
					type: "assistant",
					content: [{ type: "text", text: "<verification>FAIL: Tests are not passing</verification>" }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("Tests are not passing")
	})

	//#given a verification that times out before the agent emits a verdict
	//#when verifyCompletion is called with a short timeout
	//#then it fails closed with reason "verification_timeout"
	//
	// Plan `.matrixx/plans/bugs-remediation.md` T11 (ruling R2, bug C4): this test
	// used to assert `verified === true` on timeout ("don't block completion").
	// That assertion encoded the fail-open bug: a false positive ends the loop on
	// unverified work, while a false negative costs one extra iteration (bounded by
	// max_iterations). The old assertion is intentionally inverted, not deleted.
	test("should fail closed with verification_timeout when the poll times out", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 50,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_timeout")
	})

	//#given a session creation failure that throws
	//#when verifyCompletion is called
	//#then it fails closed with reason "verification_error"
	//
	// Plan `.matrixx/plans/bugs-remediation.md` T11 (bug C4): the exception path also
	// fails closed, so an unverified completion is never accepted because the
	// verifier itself broke.
	test("should fail closed with verification_error when session creation fails", async () => {
		const { ctx } = createMockCtx({
			createError: new Error("Session creation failed"),
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_error")
	})

	//#given a verification whose response never carries a verdict tag
	//#when verifyCompletion polls until the deadline
	//#then it fails closed with reason "verification_timeout"
	//
	// Plan `.matrixx/plans/bugs-remediation.md` T11 (bug C4): a missing verdict is an
	// unverified completion, so it must not end the loop. This test previously
	// asserted `verified === true` through the same fail-open timeout branch as the
	// timeout test above.
	test("should fail closed when the response has no verification tag", async () => {
		const { ctx } = createMockCtx({
			messagesResult: [
				{ type: "user", content: [{ type: "text", text: "Verify..." }] },
				{
					type: "assistant",
					content: [{ type: "text", text: "I reviewed the work and it looks fine." }],
				},
			],
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 50,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_timeout")
	})

	//#given a valid verification call
	//#when verifyCompletion is called
	//#then it creates a session and sends the correct prompt
	test("should create session and send verification prompt with correct agent", async () => {
		const { ctx, calls } = createMockCtx({
			messagesResult: [
				{
					type: "assistant",
					content: [{ type: "text", text: "<verification>PASS</verification>" }],
				},
			],
		})

		await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			agent: "merovingian",
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(calls.create.length).toBe(1)
		expect(calls.prompt.length).toBe(1)

		const promptCall = calls.prompt[0] as {
			sessionID: string
			agent: string
			parts: Array<{ type: string; text: string }>
		}
		expect(promptCall.agent).toBe("merovingian")
		expect(promptCall.parts[0].text).toContain("Build a REST API")
		expect(promptCall.parts[0].text).toContain("3 iteration(s)")
		expect(promptCall.parts[0].text).toContain("DONE")
	})

	//#given a session create returns error in result (not throw)
	//#when verifyCompletion is called
	//#then it fails closed with reason "verification_error"
	//
	// Plan `.matrixx/plans/bugs-remediation.md` T11 (bug C4): a verifier session that
	// was never created means verification did not run, so the completion stays
	// unverified. This test previously asserted the fail-open `verified: true`.
	test("should fail closed with verification_error when session create returns an error result", async () => {
		const { ctx } = createMockCtx({
			createResult: { error: "Something went wrong" },
		})

		const result = await verifyCompletion(ctx, {
			sessionID: "parent-session",
			directory: "/tmp/test",
			completionPromise: "DONE",
			prompt: "Build a REST API",
			iteration: 3,
			timeoutMs: 1000,
			pollIntervalMs: 10,
		})

		expect(result.verified).toBe(false)
		expect(result.reason).toBe("verification_error")
	})
})
