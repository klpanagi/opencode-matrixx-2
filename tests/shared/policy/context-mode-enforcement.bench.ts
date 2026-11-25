// P7 / T10 bench: filesystem operations for 1000 willBlockGrepGlob calls.
// Run: bun run tests/shared/policy/context-mode-enforcement.bench.ts
import { createRequire } from "node:module"
import { createFsCallCounter, formatTimingStats, time } from "../../perf/bench-utils"

const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")
const counter = createFsCallCounter()
const realExistsSync = realFs.existsSync
const realReadFileSync = realFs.readFileSync

// Plain scripts (no bun:test runner) have to patch the CJS backing object:
// ESM named imports then read it live, while `mock.module` only intercepts
// under the test runner. Patch BEFORE importing the module under test.
const mutableFs = realFs as unknown as {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding?: BufferEncoding) => string
}
mutableFs.existsSync = (path: string) => {
  counter.record("existsSync")
  return realExistsSync(path)
}
mutableFs.readFileSync = (path: string, encoding?: BufferEncoding) => {
  counter.record("readFileSync")
  return realReadFileSync(path, encoding as BufferEncoding)
}

const { _setDisciplinePathForTesting, willBlockGrepGlob } = await import(
  "../../../src/shared/policy/context-mode-enforcement"
)

const CALLS = 1000
const FAKE_PATH = "/nonexistent-ctxmode-bench/AGENTS.md"

_setDisciplinePathForTesting(FAKE_PATH)
counter.reset()
willBlockGrepGlob({ enforce: true })
const walkCost = counter.total

counter.reset()
const stats = time(() => willBlockGrepGlob({ enforce: true }), CALLS)
const after = counter.total

counter.reset()
for (let i = 0; i < CALLS; i++) {
  _setDisciplinePathForTesting(FAKE_PATH)
  willBlockGrepGlob({ enforce: true })
}
const before = counter.total

mutableFs.existsSync = realExistsSync
mutableFs.readFileSync = realReadFileSync

const reduction = before === 0 ? 0 : (1 - after / before) * 100
console.log(`P7/T10 context-mode-enforcement — willBlockGrepGlob x${CALLS}`)
console.log(`fs walk cost (one walk)  = ${walkCost}`)
console.log(`fs ops before (uncached) = ${before}`)
console.log(`fs ops after  (memoized) = ${after}`)
console.log(`reduction                = ${reduction.toFixed(2)}%`)
console.log(formatTimingStats("willBlockGrepGlob (cached)", stats))
