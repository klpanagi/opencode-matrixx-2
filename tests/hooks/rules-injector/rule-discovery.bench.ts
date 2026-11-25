/**
 * T2 (P1) benchmark for `findRuleFiles` rule discovery.
 *
 * Run with: `bun test tests/hooks/rules-injector/rule-discovery.bench.ts`
 *
 * Gates:
 *   - cache-hit p50 is at least 10% faster than a cold walk
 *   - a cache hit performs ZERO filesystem calls (host-independent gate)
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearRuleDiscoveryCache,
  findRuleFiles,
} from "../../../src/hooks/rules-injector/rule-file-finder"
import {
  assertNoFsCalls,
  createFsCallCounter,
  formatTimingStats,
  time,
} from "../../perf/bench-utils"

const ROOT = join(tmpdir(), `matrixx-rule-discovery-bench-${process.pid}`)
const ITERS = 300

let projectRoot = ""
let resolved = ""

function buildFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  projectRoot = join(ROOT, "project")

  mkdirSync(join(projectRoot, ".git"), { recursive: true })
  mkdirSync(join(projectRoot, ".github", "instructions"), { recursive: true })
  mkdirSync(join(projectRoot, ".matrixx", "rules"), { recursive: true })
  mkdirSync(join(projectRoot, ".cursor", "rules"), { recursive: true })

  for (const name of ["ts", "js", "python", "react", "backend", "docs"]) {
    writeFileSync(
      join(projectRoot, ".github", "instructions", `${name}.instructions.md`),
      `---\nglobs: "**/*.ts"\n---\n${name}`,
    )
  }
  for (const name of ["matrixx", "style", "tests", "perf"]) {
    writeFileSync(join(projectRoot, ".matrixx", "rules", `${name}.md`), `rule ${name}`)
  }
  for (const name of ["cursor-a", "cursor-b"]) {
    writeFileSync(join(projectRoot, ".cursor", "rules", `${name}.mdc`), `rule ${name}`)
  }
  writeFileSync(join(projectRoot, ".github", "copilot-instructions.md"), "always")

  resolved = join(projectRoot, "src", "features", "deep", "index.ts")
  mkdirSync(join(projectRoot, "src", "features", "deep"), { recursive: true })
  writeFileSync(resolved, "export const x = 1")
}

describe("findRuleFiles discovery cache", () => {
  beforeAll(buildFixture)

  afterAll(() => {
    clearRuleDiscoveryCache()
    rmSync(ROOT, { recursive: true, force: true })
  })

  test("cache hit is at least 10% faster than a cold walk", () => {
    const cold = time(() => {
      clearRuleDiscoveryCache()
      return findRuleFiles(projectRoot, resolved)
    }, ITERS)
    const warm = time(() => findRuleFiles(projectRoot, resolved), ITERS)

    console.log(formatTimingStats("findRuleFiles cold", cold))
    console.log(formatTimingStats("findRuleFiles cache-hit", warm))

    expect(warm.p50).toBeLessThan(cold.p50 * 0.9)
  })

  test("cache hit performs zero filesystem calls", () => {
    clearRuleDiscoveryCache()
    findRuleFiles(projectRoot, resolved)

    const counter = createFsCallCounter()
    const spies: Array<{ operation: string; spy: ReturnType<typeof spyOn> }> = []
    for (const operation of ["existsSync", "statSync", "readdirSync", "realpathSync"] as const) {
      spies.push({ operation, spy: spyOn(fs, operation) })
    }

    try {
      findRuleFiles(projectRoot, resolved)
      for (const { operation, spy } of spies) {
        for (let i = 0; i < spy.mock.calls.length; i++) counter.record(operation)
      }
      assertNoFsCalls(counter, "findRuleFiles cache hit")
    } finally {
      for (const { spy } of spies) spy.mockRestore()
    }
  })
})
