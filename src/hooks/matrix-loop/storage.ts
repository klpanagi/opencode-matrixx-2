import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { atomicWrite } from "../../features/mission-state/atomic-write"
import { parseFrontmatter } from "../../shared/io/frontmatter"
import { log } from "../../shared/runtime/logger"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	DEFAULT_STATE_FILE,
	HOOK_NAME,
	MATRIX_LOOP_STATE_DIR,
} from "./constants"
import type { MatrixLoopState } from "./types"

const stateOperationChains = new Map<string, Promise<unknown>>()

function sanitizeSessionID(sessionID: string): string {
	const sanitized = sessionID.replace(/[^A-Za-z0-9_-]/g, "_")
	return sanitized.length > 0 ? sanitized : "session"
}

export function sessionStatePath(
	directory: string,
	sessionID?: string,
	customPath?: string,
): string {
	if (customPath) {
		return join(directory, customPath)
	}
	if (!sessionID) {
		return join(directory, DEFAULT_STATE_FILE)
	}
	return join(directory, MATRIX_LOOP_STATE_DIR, `${sanitizeSessionID(sessionID)}.md`)
}

function enqueueStateOperation<T>(
	filePath: string,
	operation: () => Promise<T> | T,
): Promise<T> {
	const previous = stateOperationChains.get(filePath) ?? Promise.resolve()
	const next = previous.then(operation, operation)
	stateOperationChains.set(filePath, next)
	const releaseChain = () => {
		if (stateOperationChains.get(filePath) === next) {
			stateOperationChains.delete(filePath)
		}
	}
	next.then(releaseChain, releaseChain)
	return next
}

function readStateFile(filePath: string): MatrixLoopState | null {
	if (!existsSync(filePath)) {
		return null
	}

	try {
		const content = readFileSync(filePath, "utf-8")
		const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

		const active = data.active
		const iteration = data.iteration

		if (active === undefined || iteration === undefined) {
			return null
		}

		const isActive = active === true || active === "true"
		const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)

		if (Number.isNaN(iterationNum)) {
			return null
		}

		const stripQuotes = (val: unknown): string => {
			const str = String(val ?? "")
			return str.replace(/^["']|["']$/g, "")
		}

		const verificationFailedCount = data.verification_failed_count !== undefined
			? Number(data.verification_failed_count)
			: undefined

		return {
			active: isActive,
			iteration: iterationNum,
			max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
			completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
			started_at: stripQuotes(data.started_at) || new Date().toISOString(),
			prompt: body.trim(),
			session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
			redpill: data.redpill === true || data.redpill === "true" ? true : undefined,
			verification_failed_count: verificationFailedCount && !Number.isNaN(verificationFailedCount) ? verificationFailedCount : undefined,
		}
	} catch (err) {
		log(`[${HOOK_NAME}] Failed to read loop state`, { filePath, error: String(err) })
		return null
	}
}

function writeStateFile(filePath: string, state: MatrixLoopState): boolean {
	try {
		const dir = dirname(filePath)
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true })
		}

		const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
		const redpillLine = state.redpill !== undefined ? `redpill: ${state.redpill}\n` : ""
		const verificationLine = state.verification_failed_count !== undefined ? `verification_failed_count: ${state.verification_failed_count}\n` : ""
		const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
started_at: "${state.started_at}"
${sessionIdLine}${redpillLine}${verificationLine}---
${state.prompt}
`

		if (!atomicWrite(filePath, content)) {
			log(`[${HOOK_NAME}] Failed to write loop state`, { filePath })
			return false
		}
		return true
	} catch (err) {
		log(`[${HOOK_NAME}] Failed to write loop state`, { filePath, error: String(err) })
		return false
	}
}

function clearStateFile(filePath: string): boolean {
	try {
		if (existsSync(filePath)) {
			unlinkSync(filePath)
		}
		return true
	} catch (err) {
		log(`[${HOOK_NAME}] Failed to clear loop state`, { filePath, error: String(err) })
		return false
	}
}

export function readState(
	directory: string,
	sessionID?: string,
	customPath?: string,
): MatrixLoopState | null {
	return readStateFile(sessionStatePath(directory, sessionID, customPath))
}

export function writeState(
	directory: string,
	state: MatrixLoopState,
	sessionID?: string,
	customPath?: string,
): boolean {
	return writeStateFile(sessionStatePath(directory, sessionID, customPath), state)
}

export function clearState(
	directory: string,
	sessionID?: string,
	customPath?: string,
): boolean {
	return clearStateFile(sessionStatePath(directory, sessionID, customPath))
}

function incrementStateFile(filePath: string): MatrixLoopState | null {
	const state = readStateFile(filePath)
	if (!state) return null

	state.iteration += 1
	if (!writeStateFile(filePath, state)) {
		log(`[${HOOK_NAME}] Failed to persist iteration increment`, {
			filePath,
			iteration: state.iteration,
		})
		return null
	}
	return state
}

// Serialized increment for asynchronous callers: the read-modify-write is chained
// behind the previous operation on the same resolved state path, so two concurrent
// increments cannot read the same iteration count.
export function incrementIteration(
	directory: string,
	sessionID?: string,
	customPath?: string,
): Promise<MatrixLoopState | null> {
	const filePath = sessionStatePath(directory, sessionID, customPath)

	return enqueueStateOperation(filePath, () => incrementStateFile(filePath))
}

// Synchronous increment for callers that cannot await (the loop event handler).
// The critical section is synchronous file I/O, so it runs to completion before
// any other increment in this process can start.
export function incrementIterationSync(
	directory: string,
	sessionID?: string,
	customPath?: string,
): MatrixLoopState | null {
	return incrementStateFile(sessionStatePath(directory, sessionID, customPath))
}
