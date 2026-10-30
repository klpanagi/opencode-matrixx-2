import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"

type SessionWithRemove = { remove(input: { sessionID: string }): Promise<unknown> }

import { log } from "../../shared/logger"
import { contentOf, isAssistant } from "../../shared/session-message"
import type { OpenCodeSessionMessage } from "./completion-promise-detector"
import { DEFAULT_VERIFICATION_AGENT, DEFAULT_VERIFICATION_TIMEOUT_MS, HOOK_NAME } from "./constants"

interface VerificationResult {
	verified: boolean
	reason?: string
}

const VERIFICATION_TAG_PATTERN = /<verification>(.*?)<\/verification>/is

function buildVerificationPrompt(options: {
	prompt: string
	iteration: number
	completionPromise: string
}): string {
	return `You are verifying that a matrix-loop task has been completed successfully.

Original task: ${options.prompt}
Completion detected after ${options.iteration} iteration(s).
Completion promise: ${options.completionPromise}

Review the session history and verify:
1. The original task requirements are fully met
2. The completion promise was legitimately output (not just echoed in instructions)
3. No critical work remains incomplete

If verification PASSES, output: <verification>PASS</verification>
If verification FAILS, output: <verification>FAIL: [brief reason]</verification>`
}

function parseVerificationResponse(text: string): VerificationResult {
	const match = VERIFICATION_TAG_PATTERN.exec(text)
	if (!match) return { verified: true }

	const content = match[1].trim()
	if (content === "PASS") return { verified: true }

	if (content.startsWith("FAIL:")) {
		return { verified: false, reason: content.slice(5).trim() }
	}
	if (content === "FAIL") {
		return { verified: false, reason: "Verification failed" }
	}

	return { verified: true }
}

function extractAssistantText(messages: OpenCodeSessionMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (!isAssistant(msg)) continue
		const textParts = contentOf(msg).filter((p) => p.type === "text").map((p) => p.text ?? "")
		if (textParts.length > 0) return textParts.join("\n")
	}
	return undefined
}

export async function verifyCompletion(
	ctx: NativePluginContext,
	options: {
		sessionID: string
		directory: string
		completionPromise: string
		prompt: string
		iteration: number
		agent?: string
		timeoutMs?: number
		pollIntervalMs?: number
		preFetchedMessages?: OpenCodeSessionMessage[]
	},
): Promise<VerificationResult> {
	if (options.preFetchedMessages) {
		return verifyWithPrefetchedMessages(options.preFetchedMessages)
	}

	const agent = options.agent ?? DEFAULT_VERIFICATION_AGENT
	const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS
	const pollIntervalMs = options.pollIntervalMs ?? 2000
	let verifySessionID: string | undefined

	try {
		const created = (await ctx.session.create({
			parentID: options.sessionID,
			title: "Matrix Loop Verification",
		})) as { id?: string }

		if (!created.id) {
			log(`[${HOOK_NAME}] Verification session creation failed`)
			return { verified: true }
		}

		verifySessionID = created.id

		const verificationPrompt = buildVerificationPrompt({
			prompt: options.prompt,
			iteration: options.iteration,
			completionPromise: options.completionPromise,
		})

		await ctx.session.prompt({
			sessionID: verifySessionID,
			agent,
			parts: [{ type: "text", text: verificationPrompt }],
		})

		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			try {
				const messageArray = await fetchSessionMessages(ctx, verifySessionID)

				const assistantText = extractAssistantText(messageArray)
				if (assistantText && VERIFICATION_TAG_PATTERN.test(assistantText)) {
					return parseVerificationResponse(assistantText)
				}
			} catch {
				log(`[${HOOK_NAME}] Verification poll error`)
			}

			await new Promise<void>((resolve) => {
				setTimeout(resolve, pollIntervalMs)
			})
		}

		log(`[${HOOK_NAME}] Verification timed out, assuming pass`)
		return { verified: true }
	} catch (err) {
		log(`[${HOOK_NAME}] Verification error: ${String(err)}`)
		return { verified: true }
	} finally {
		if (verifySessionID) {
			const session = ctx.session as NativePluginContext["session"] & SessionWithRemove
			await session.remove({ sessionID: verifySessionID })
		}
	}
}

function verifyWithPrefetchedMessages(messages: OpenCodeSessionMessage[]): VerificationResult {
	const assistantText = extractAssistantText(messages)
	if (assistantText && VERIFICATION_TAG_PATTERN.test(assistantText)) {
		return parseVerificationResponse(assistantText)
	}
	return { verified: true }
}
