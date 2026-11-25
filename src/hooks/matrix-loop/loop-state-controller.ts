import { log } from "../../shared/runtime/logger"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	HOOK_NAME,
} from "./constants"
import {
	clearState,
	incrementIterationSync,
	readState,
	writeState,
} from "./storage"
import type { MatrixLoopOptions, MatrixLoopState } from "./types"

export function createLoopStateController(options: {
	directory: string
	stateDir: string | undefined
	config: MatrixLoopOptions["config"] | undefined
}) {
	const directory = options.directory
	const stateDir = options.stateDir
	const config = options.config
	let lastStartedSessionID: string | undefined

	const resolveSessionID = (sessionID?: string): string | undefined =>
		sessionID ?? lastStartedSessionID

	// The project-global file written before per-session state existed stays
	// authoritative while it is present, so an in-flight loop survives the upgrade
	// and callers without a session id keep reading the file they wrote.
	const readSharedState = (): MatrixLoopState | null =>
		readState(directory, undefined, stateDir)

	return {
		startLoop(
			sessionID: string,
			prompt: string,
			loopOptions?: {
				maxIterations?: number
				completionPromise?: string
				redpill?: boolean
			},
		): boolean {
			const state: MatrixLoopState = {
				active: true,
				iteration: 1,
				max_iterations:
					loopOptions?.maxIterations ??
					config?.default_max_iterations ??
					DEFAULT_MAX_ITERATIONS,
				completion_promise:
					loopOptions?.completionPromise ??
					DEFAULT_COMPLETION_PROMISE,
				redpill: loopOptions?.redpill,
				started_at: new Date().toISOString(),
				prompt,
				session_id: sessionID,
			}

			// A new loop replaces the single-slot state instead of inheriting it.
			clearState(directory, undefined, stateDir)
			const success = writeState(directory, state, sessionID, stateDir)
			if (success) {
				lastStartedSessionID = sessionID
				log(`[${HOOK_NAME}] Loop started`, {
					sessionID,
					maxIterations: state.max_iterations,
					completionPromise: state.completion_promise,
				})
			}
			return success
		},

		cancelLoop(sessionID: string): boolean {
			const state = readState(directory, sessionID, stateDir) ?? readSharedState()
			if (!state || state.session_id !== sessionID) {
				return false
			}

			const clearedSession = clearState(directory, sessionID, stateDir)
			const clearedShared = clearState(directory, undefined, stateDir)
			const success = clearedSession && clearedShared
			if (success) {
				if (lastStartedSessionID === sessionID) {
					lastStartedSessionID = undefined
				}
				log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
			}
			return success
		},

		getState(sessionID?: string): MatrixLoopState | null {
			const shared = readSharedState()
			if (shared) {
				return shared
			}

			const resolvedSessionID = resolveSessionID(sessionID)
			return resolvedSessionID ? readState(directory, resolvedSessionID, stateDir) : null
		},

		clear(sessionID?: string): boolean {
			const resolvedSessionID = resolveSessionID(sessionID)
			const clearedSession = resolvedSessionID
				? clearState(directory, resolvedSessionID, stateDir)
				: true
			const clearedShared = clearState(directory, undefined, stateDir)
			return clearedSession && clearedShared
		},

		incrementIteration(sessionID?: string): MatrixLoopState | null {
			if (readSharedState()) {
				return incrementIterationSync(directory, undefined, stateDir)
			}

			const resolvedSessionID = resolveSessionID(sessionID)
			if (!resolvedSessionID) {
				return null
			}
			return incrementIterationSync(directory, resolvedSessionID, stateDir)
		},
	}
}
