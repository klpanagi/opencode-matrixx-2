import { log } from "../../shared/logger"
import { notify } from "../../shared/notify"
import type { NativePluginContext } from "../../shared/session-context-source"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { withTimeout } from "../../shared/with-timeout"
import type { OpenCodeSessionMessage } from "./completion-promise-detector"
import { detectCompletionInSessionMessages, detectCompletionInTranscript } from "./completion-promise-detector"
import { verifyCompletion } from "./completion-verifier"
import { DEFAULT_VERIFICATION_AGENT, DEFAULT_VERIFICATION_MAX_RETRIES, DEFAULT_VERIFICATION_TIMEOUT_MS, HOOK_NAME } from "./constants"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { MatrixLoopOptions, MatrixLoopState } from "./types"

type SessionRecovery = { isRecovering: (sessionID: string) => boolean; markRecovering: (sessionID: string) => void; clear: (sessionID: string) => void }
type LoopStateController = { getState: () => MatrixLoopState | null; clear: () => boolean; incrementIteration: () => MatrixLoopState | null }
type MatrixLoopEventHandlerOptions = { directory: string; apiTimeoutMs: number; getTranscriptPath: (sessionID: string) => string | undefined; checkSessionExists?: MatrixLoopOptions["checkSessionExists"]; sessionRecovery: SessionRecovery; loopState: LoopStateController; verification?: MatrixLoopOptions["verification"] }

async function handleVerificationFailure(
	ctx: NativePluginContext,
	options: MatrixLoopEventHandlerOptions,
	state: MatrixLoopState,
	sessionID: string,
	reason: string | undefined,
	failedCount: number,
): Promise<void> {
	log(`[${HOOK_NAME}] Verification failed`, { sessionID, reason })
	const newState = options.loopState.incrementIteration()
	if (newState) {
		newState.verification_failed_count = failedCount + 1
		const { writeState } = await import("./storage")
		writeState(options.directory, newState)
	}
	try {
		const feedback = `Verification FAILED: ${reason ?? "Unknown reason"}. The completion was rejected — continue working.`
		await injectContinuationPrompt(ctx, {
			sessionID,
			prompt: `${feedback}\n\n${buildContinuationPrompt(newState ?? state)}`,
			directory: options.directory,
			apiTimeoutMs: options.apiTimeoutMs,
		})
	} catch (err) {
		log(`[${HOOK_NAME}] Failed to inject verification feedback`, { sessionID, error: String(err) })
	}
}

import type { V2Event } from "../../plugin/context"
export function createMatrixLoopEventHandler(ctx: NativePluginContext, options: MatrixLoopEventHandlerOptions) {
	const inFlightSessions = new Set<string>()

	return async (event: V2Event): Promise<void> => {
		const props = event.data as Record<string, unknown> | undefined

		if (event.type === "session.idle") {
			const sessionID = props?.sessionID as string | undefined
			if (!sessionID) return
			if (inFlightSessions.has(sessionID)) {
				log(`[${HOOK_NAME}] Skipped: handler in flight`, { sessionID })
				return
			}
			inFlightSessions.add(sessionID)
			try {
				if (options.sessionRecovery.isRecovering(sessionID)) {
					log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
					return
				}
				const state = options.loopState.getState()
				if (!state?.active) return

				if (state.session_id && state.session_id !== sessionID) {
					if (options.checkSessionExists) {
						try {
							const exists = await options.checkSessionExists(state.session_id)
							if (!exists) {
								options.loopState.clear()
								log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, { orphanedSessionId: state.session_id, currentSessionId: sessionID })
								return
							}
						} catch (err) {
							log(`[${HOOK_NAME}] Failed to check session existence`, { sessionId: state.session_id, error: String(err) })
						}
					}
					return
				}

				const transcriptPath = options.getTranscriptPath(sessionID)
				const completionViaTranscript = detectCompletionInTranscript(transcriptPath, state.completion_promise)

				// Cache the session context response so detector AND verifier can share it (H4)
				let messages: OpenCodeSessionMessage[] | undefined
				if (!completionViaTranscript) {
					try {
						messages = await withTimeout(
							fetchSessionMessages(ctx, sessionID),
							options.apiTimeoutMs,
						)
					} catch (err) {
						setTimeout(() => {
							log(`[${HOOK_NAME}] Session messages fetch failed`, { sessionID, error: String(err) })
						}, 0)
						messages = []
					}
				}

				const completionViaApi = completionViaTranscript
					? false
					: await detectCompletionInSessionMessages(ctx, {
							sessionID,
							promise: state.completion_promise,
							apiTimeoutMs: options.apiTimeoutMs,
							directory: options.directory,
							preFetchedMessages: messages,
						})

				if (completionViaTranscript || completionViaApi) {
					log(`[${HOOK_NAME}] Completion detected!`, { sessionID, iteration: state.iteration, promise: state.completion_promise, detectedVia: completionViaTranscript ? "transcript_file" : "session_messages_api" })

					if (options.verification?.enabled === true) {
						const maxRetries = options.verification?.maxRetries ?? DEFAULT_VERIFICATION_MAX_RETRIES
						const failedCount = state.verification_failed_count ?? 0

						if (failedCount >= maxRetries) {
							options.loopState.clear()
							notify("warn", `Matrix Loop Complete: Force-completed after ${failedCount} failed verification(s)`)
							return
						}

						const result = await verifyCompletion(ctx, {
							sessionID, directory: options.directory, completionPromise: state.completion_promise,
							prompt: state.prompt, iteration: state.iteration,
							agent: options.verification?.agent ?? DEFAULT_VERIFICATION_AGENT,
							timeoutMs: options.verification?.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
							preFetchedMessages: messages,
						})

						if (!result.verified) {
							await handleVerificationFailure(ctx, options, state, sessionID, result.reason, failedCount)
							return
						}
					}

					options.loopState.clear()
					const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Matrix Loop Complete!"
					const message = state.ultrawork ? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)` : `Task completed after ${state.iteration} iteration(s)`
					notify("success", `${title}: ${message}`)
					return
				}

				if (state.iteration >= state.max_iterations) {
					log(`[${HOOK_NAME}] Max iterations reached`, { sessionID, iteration: state.iteration, max: state.max_iterations })
					options.loopState.clear()
					notify("warn", `Matrix Loop Stopped: Max iterations (${state.max_iterations}) reached without completion`)
					return
				}

				const newState = options.loopState.incrementIteration()
				if (!newState) {
					log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID })
					return
				}
				log(`[${HOOK_NAME}] Continuing loop`, { sessionID, iteration: newState.iteration, max: newState.max_iterations })
				notify("info", `Matrix Loop: Iteration ${newState.iteration}/${newState.max_iterations}`)

				try {
					await injectContinuationPrompt(ctx, { sessionID, prompt: buildContinuationPrompt(newState), directory: options.directory, apiTimeoutMs: options.apiTimeoutMs })
				} catch (err) {
					log(`[${HOOK_NAME}] Failed to inject continuation`, { sessionID, error: String(err) })
				}
				return
			} finally {
				inFlightSessions.delete(sessionID)
			}
		}

		if (event.type === "session.deleted") {
			const sessionInfo = props?.info as { id?: string } | undefined
			if (!sessionInfo?.id) return
			const state = options.loopState.getState()
			if (state?.session_id === sessionInfo.id) {
				options.loopState.clear()
				log(`[${HOOK_NAME}] Session deleted, loop cleared`, { sessionID: sessionInfo.id })
			}
			options.sessionRecovery.clear(sessionInfo.id)
			return
		}

		if (event.type === "session.error") {
			const sessionID = props?.sessionID as string | undefined
			const error = props?.error as { name?: string } | undefined
			if (error?.name === "MessageAbortedError") {
				if (sessionID) {
					const state = options.loopState.getState()
					if (state?.session_id === sessionID) {
						options.loopState.clear()
						log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID })
					}
					options.sessionRecovery.clear(sessionID)
				}
				return
			}
			if (sessionID) {
				options.sessionRecovery.markRecovering(sessionID)
			}
		}
	}
}
