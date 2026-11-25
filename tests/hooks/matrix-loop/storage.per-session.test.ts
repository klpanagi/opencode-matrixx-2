/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_STATE_FILE, MATRIX_LOOP_STATE_DIR } from "../../../src/hooks/matrix-loop/constants"
import { createMatrixLoopHook } from "../../../src/hooks/matrix-loop/matrix-loop-hook"
import {
	clearState,
	incrementIteration,
	readState,
	sessionStatePath,
	writeState,
} from "../../../src/hooks/matrix-loop/storage"
import type { MatrixLoopState } from "../../../src/hooks/matrix-loop/types"

function makeState(overrides: Partial<MatrixLoopState>): MatrixLoopState {
	return {
		active: true,
		iteration: 1,
		max_iterations: 10,
		completion_promise: "DONE",
		started_at: "2026-01-01T00:00:00.000Z",
		prompt: "default prompt",
		...overrides,
	}
}

function createMockContext(directory: string) {
	return {
		session: {
			prompt: async () => ({}),
			context: async () => [],
		},
		directory,
	} as unknown as Parameters<typeof createMatrixLoopHook>[0]
}

describe("matrix-loop per-session storage", () => {
	let testDir: string

	beforeEach(() => {
		testDir = join(tmpdir(), `matrix-loop-per-session-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		mkdirSync(testDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true })
	})

	test("a second session starting a loop does not overwrite the first", () => {
		//#given one hook on a project directory and two sessions starting a loop
		const hook = createMatrixLoopHook(createMockContext(testDir))
		const startedAlpha = hook.startLoop("ses_alpha", "Build alpha")
		const startedBeta = hook.startLoop("ses_beta", "Build beta")

		//#when inspecting the state files for each session
		const sharedLegacyFile = join(testDir, DEFAULT_STATE_FILE)

		//#then each session keeps its own prompt and the shared single file is gone
		expect(startedAlpha).toBe(true)
		expect(startedBeta).toBe(true)
		expect(existsSync(sharedLegacyFile)).toBe(false)
		expect(readState(testDir, "ses_alpha")?.prompt).toBe("Build alpha")
		expect(readState(testDir, "ses_beta")?.prompt).toBe("Build beta")
	})

	test("keeps independent state for two sessions in the same directory", () => {
		//#given two sessions writing loop state in the same project directory
		const sessionA = "ses_session_a"
		const sessionB = "ses_session_b"
		const stateA = makeState({ iteration: 3, prompt: "prompt for A", session_id: sessionA })
		const stateB = makeState({ iteration: 7, prompt: "prompt for B", session_id: sessionB })

		//#when each session writes and then reads its own state
		expect(writeState(testDir, stateA, sessionA)).toBe(true)
		expect(writeState(testDir, stateB, sessionB)).toBe(true)
		const readA = readState(testDir, sessionA)
		const readB = readState(testDir, sessionB)

		//#then neither session overwrites the other
		expect(readA?.iteration).toBe(3)
		expect(readA?.prompt).toBe("prompt for A")
		expect(readA?.session_id).toBe(sessionA)
		expect(readB?.iteration).toBe(7)
		expect(readB?.prompt).toBe("prompt for B")
		expect(readB?.session_id).toBe(sessionB)
	})

	test("serializes 50 concurrent increments without losing an update", async () => {
		//#given one session with an initial iteration of 0
		const sessionID = "ses_concurrent"
		expect(writeState(testDir, makeState({ iteration: 0, session_id: sessionID }), sessionID)).toBe(true)

		//#when 50 increments run concurrently against the same session
		const results = await Promise.all(
			Array.from({ length: 50 }, () => incrementIteration(testDir, sessionID)),
		)

		//#then every increment is accounted for exactly once
		const finalState = readState(testDir, sessionID)
		expect(results.filter((state) => state !== null).length).toBe(50)
		expect(finalState?.iteration).toBe(50)
	})

	test("writes each session to a sanitized file under the state dir", () => {
		//#given a session id containing characters outside [A-Za-z0-9_-]
		const sessionID = "ses/../weird id!"

		//#when resolving the state path
		const resolved = sessionStatePath(testDir, sessionID)

		//#then the file name is sanitized and scoped under the matrix-loop state dir
		expect(resolved).toBe(join(testDir, MATRIX_LOOP_STATE_DIR, "ses____weird_id_.md"))
	})

	test("customPath keeps legacy behaviour and no session id falls back to the single file", () => {
		//#given a custom path and a call with no session id
		const customPath = "custom/state.md"

		//#when resolving both paths
		const customResolved = sessionStatePath(testDir, "ses_ignored", customPath)
		const legacyResolved = sessionStatePath(testDir, undefined)

		//#then the custom path wins and the legacy single file is preserved
		expect(customResolved).toBe(join(testDir, customPath))
		expect(legacyResolved).toBe(join(testDir, DEFAULT_STATE_FILE))
	})

	test("clears only the targeted session state file", () => {
		//#given two sessions with state and one session id to clear
		const sessionA = "ses_clear_a"
		const sessionB = "ses_clear_b"
		const pathA = sessionStatePath(testDir, sessionA)
		const pathB = sessionStatePath(testDir, sessionB)
		writeState(testDir, makeState({ session_id: sessionA }), sessionA)
		writeState(testDir, makeState({ session_id: sessionB }), sessionB)

		//#when clearing session A
		expect(clearState(testDir, sessionA)).toBe(true)

		//#then only A's file is gone while B's remains readable
		expect(existsSync(pathA)).toBe(false)
		expect(existsSync(pathB)).toBe(true)
		expect(readState(testDir, sessionA)).toBeNull()
		expect(readState(testDir, sessionB)?.session_id).toBe(sessionB)
	})
})
