/// <reference types="bun-types" />

import { afterAll, describe, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { createFsCallCounter } from "../../perf/bench-utils"

// context-mode-enforcement reads `node:fs` through ESM live bindings, so the
// mock must be registered before the module under test resolves its imports
// (same shape as tests/shared/dcp-switch-profile.test.ts). `createRequire`
// bypasses the mock registry, keeping delegation to the real fs safe. This file
// is isolated via script/mock-heavy-list.txt because `mock.module` is
// process-wide.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")
const counter = createFsCallCounter()
const realExistsSync = realFs.existsSync
const realReadFileSync = realFs.readFileSync

mock.module("node:fs", () => ({
  existsSync: mock((path: string) => {
    counter.record("existsSync")
    return realExistsSync(path)
  }),
  readFileSync: mock((path: string, encoding?: BufferEncoding) => {
    counter.record("readFileSync")
    return realReadFileSync(path, encoding as BufferEncoding)
  }),
}))

import {
  _resetContextModeEnforcementForTesting,
  _setDisciplinePathForTesting,
  deriveContextModeRootFromFile,
  hasWorkingSubstitute,
  resolveContextModeDisciplinePath,
  willBlockGrepGlob,
} from "../../../src/shared/policy/context-mode-enforcement"

// A path that exists nowhere: the walk terminates at `/` in a couple of reads,
// which keeps the per-walk fs cost small and fully deterministic.
const FAKE_PATH = "/nonexistent-ctxmode-fixture/AGENTS.md"
const FAKE_OTHER = "/nonexistent-ctxmode-other/AGENTS.md"
const CALLS = 1000

afterAll(() => {
  // `mock.module("node:fs")` is process-wide and outlives `mock.restore()`.
  // Leave the shared registry delegating to the real fs for any later suite.
  mock.module("node:fs", () => realFs)
  mock.restore()
})

describe("context-mode-enforcement memoization (P7)", () => {
  test("1000 enforced checks after a prime perform zero fs calls (one walk total)", () => {
    //#given an explicit discipline path so the resolved value is deterministic
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(FAKE_PATH)

    //#when the first check primes the process-wide memo
    counter.reset()
    expect(willBlockGrepGlob({ enforce: true })).toBe(true)
    const walkCost = counter.total

    //#then the walk is paid once, never again
    expect(walkCost).toBeGreaterThan(0)
    counter.reset()
    let blocked = false
    for (let i = 0; i < CALLS; i++) blocked = willBlockGrepGlob({ enforce: true })
    expect(blocked).toBe(true)
    expect(counter.total).toBe(0)
  })

  test("memoization cuts fs operations by at least 95% across 1000 checks", () => {
    //#given the pre-memo behaviour, reproduced by invalidating the memo per call
    _resetContextModeEnforcementForTesting()
    _setDisciplinePathForTesting(FAKE_PATH)
    counter.reset()
    for (let i = 0; i < CALLS; i++) {
      _setDisciplinePathForTesting(FAKE_PATH)
      willBlockGrepGlob({ enforce: true })
    }
    const before = counter.total

    //#when the memo is warmed once and then serves every check
    _setDisciplinePathForTesting(FAKE_PATH)
    willBlockGrepGlob({ enforce: true })
    counter.reset()
    for (let i = 0; i < CALLS; i++) willBlockGrepGlob({ enforce: true })
    const after = counter.total

    //#then the fs-op count collapses by >=95%
    expect(before).toBeGreaterThan(0)
    expect(1 - after / before).toBeGreaterThanOrEqual(0.95)
  })

  test("discovery mode walks once across 1000 enforced checks", () => {
    //#given no override, so the real discovery path runs
    _resetContextModeEnforcementForTesting()
    counter.reset()
    willBlockGrepGlob({ enforce: true })
    const walkCost = counter.total

    //#when checked 1000 more times
    counter.reset()
    for (let i = 0; i < CALLS; i++) willBlockGrepGlob({ enforce: true })

    //#then discovery is memoized and never re-walks the fs
    expect(walkCost).toBeGreaterThan(0)
    expect(counter.total).toBe(0)
  })

  test("_setDisciplinePathForTesting invalidates the memo when the input changes", () => {
    //#given a warmed memo for one path
    _setDisciplinePathForTesting(FAKE_PATH)
    expect(resolveContextModeDisciplinePath()).toBe(FAKE_PATH)

    //#when the override changes
    _setDisciplinePathForTesting(FAKE_OTHER)

    //#then the cache never serves the stale path
    expect(resolveContextModeDisciplinePath()).toBe(FAKE_OTHER)
    _setDisciplinePathForTesting(null)
    expect(resolveContextModeDisciplinePath()).toBeNull()
    expect(hasWorkingSubstitute()).toBe(false)
  })

  test("_resetContextModeEnforcementForTesting clears the memo", () => {
    //#given a warmed memo
    _setDisciplinePathForTesting(FAKE_PATH)
    expect(hasWorkingSubstitute()).toBe(true)

    //#when reset, so the discovery path has to run again
    _resetContextModeEnforcementForTesting()
    counter.reset()
    willBlockGrepGlob({ enforce: true })

    //#then fs access recurs because the memo was dropped
    expect(counter.total).toBeGreaterThan(0)
  })

  test("deriveContextModeRootFromFile memoizes per input path", () => {
    //#given a cold cache for this path
    _resetContextModeEnforcementForTesting()
    counter.reset()
    const first = deriveContextModeRootFromFile(FAKE_PATH)
    const afterFirst = counter.total

    //#when called again with the same input
    const second = deriveContextModeRootFromFile(FAKE_PATH)

    //#then the same answer is served with no additional fs access
    expect(second).toBe(first)
    expect(afterFirst).toBeGreaterThan(0)
    expect(counter.total).toBe(afterFirst)
  })
})
