/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GitleaksScanSpawn } from "../../../src/hooks/secret-leak-guard/gitleaks-runner"

type RunnerModule = typeof import("../../../src/hooks/secret-leak-guard/gitleaks-runner")

// `hook.test.ts` registers a process-wide `mock.module` for this module; the
// query suffix loads the real implementation even when that mock is active.
const runnerSpecifier = "../../../src/hooks/secret-leak-guard/gitleaks-runner?secret-leak-guard-test"
const runner = (await import(runnerSpecifier)) as RunnerModule

const {
  _resetGitleaksRunnerForTesting,
  _setGitleaksAvailableForTesting,
  _setScanSpawnForTesting,
  _setStagedFingerprintForTesting,
  runGitleaksStagedScan,
} = runner

interface ScanStep {
  exitCode: number
  stdout: string
}

interface FakeScan {
  spawn: GitleaksScanSpawn
  calls: () => number
}

function createFakeScan(steps: ScanStep[]): FakeScan {
  let calls = 0
  const spawn: GitleaksScanSpawn = () => {
    const step = steps[Math.min(calls, steps.length - 1)] ?? { exitCode: 0, stdout: "[]" }
    calls += 1
    return {
      exited: Promise.resolve(step.exitCode),
      stdout: new Response(step.stdout).body as ReadableStream<Uint8Array>,
      kill: () => {},
    }
  }
  return { spawn, calls: () => calls }
}

function finding(ruleID: string, file: string): string {
  return JSON.stringify([
    {
      RuleID: ruleID,
      Match: "sk-...",
      File: file,
      StartLine: 1,
      EndLine: 1,
      Description: `${ruleID} detected`,
    },
  ])
}

function runGit(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`)
  }
}

afterEach(() => {
  _resetGitleaksRunnerForTesting()
})

describe("runGitleaksStagedScan", () => {
  test("reuses the result for an unchanged staged set", async () => {
    //#given: a stable staged fingerprint and a scan that reports one finding
    _setGitleaksAvailableForTesting(true)
    _setStagedFingerprintForTesting(async () => "staged-set-v1")
    const scan = createFakeScan([{ exitCode: 1, stdout: finding("generic-api-key", "src/a.ts") }])
    _setScanSpawnForTesting(scan.spawn)

    //#when: the same working tree is scanned twice
    const first = await runGitleaksStagedScan("/repo")
    const second = await runGitleaksStagedScan("/repo")

    //#then: only one scan ran and both callers saw the same findings
    expect(scan.calls()).toBe(1)
    expect(second).toBe(first)
    expect(second.findings).toEqual(first.findings)
    expect(second.findings).toHaveLength(1)
  })

  test("rescans when the staged blob set changes", async () => {
    //#given: a fingerprint that changes between calls
    _setGitleaksAvailableForTesting(true)
    let fingerprint = "staged-set-v1"
    _setStagedFingerprintForTesting(async () => fingerprint)
    const scan = createFakeScan([
      { exitCode: 1, stdout: finding("generic-api-key", "src/a.ts") },
      { exitCode: 1, stdout: finding("private-key", "certs/key.pem") },
    ])
    _setScanSpawnForTesting(scan.spawn)

    //#when: the staged set changes between scans
    const first = await runGitleaksStagedScan("/repo")
    fingerprint = "staged-set-v2"
    const second = await runGitleaksStagedScan("/repo")

    //#then: both sets were scanned and each result is its own
    expect(scan.calls()).toBe(2)
    expect(first.findings[0]?.RuleID).toBe("generic-api-key")
    expect(second.findings[0]?.RuleID).toBe("private-key")
  })

  test("keeps one cache entry per working tree", async () => {
    //#given: identical fingerprints in two different working trees
    _setGitleaksAvailableForTesting(true)
    _setStagedFingerprintForTesting(async () => "same-fingerprint")
    const scan = createFakeScan([{ exitCode: 0, stdout: "[]" }])
    _setScanSpawnForTesting(scan.spawn)

    //#when: both working trees are scanned
    await runGitleaksStagedScan("/repo-a")
    await runGitleaksStagedScan("/repo-b")

    //#then: the cache key includes cwd, so both scanned once
    expect(scan.calls()).toBe(2)
  })

  test("scans every time when the staged fingerprint is unavailable", async () => {
    //#given: a working tree whose fingerprint cannot be computed
    _setGitleaksAvailableForTesting(true)
    _setStagedFingerprintForTesting(async () => null)
    const scan = createFakeScan([{ exitCode: 0, stdout: "[]" }])
    _setScanSpawnForTesting(scan.spawn)

    //#when: the same working tree is scanned twice
    await runGitleaksStagedScan("/repo")
    await runGitleaksStagedScan("/repo")

    //#then: no skip is possible without a fingerprint
    expect(scan.calls()).toBe(2)
  })

  test("does not cache a failed scan", async () => {
    //#given: a scanner that fails to start
    _setGitleaksAvailableForTesting(true)
    _setStagedFingerprintForTesting(async () => "staged-set-v1")
    let calls = 0
    _setScanSpawnForTesting(() => {
      calls += 1
      throw new Error("spawn failed")
    })

    //#when: the same working tree is scanned twice
    const first = await runGitleaksStagedScan("/repo")
    const second = await runGitleaksStagedScan("/repo")

    //#then: the transient failure is retried instead of cached
    expect(calls).toBe(2)
    expect(first.error).toBe("gitleaks timed out or failed to start")
    expect(second.error).toBe("gitleaks timed out or failed to start")
  })

  test("returns unavailable without scanning when gitleaks is missing", async () => {
    //#given: gitleaks is not installed
    _setGitleaksAvailableForTesting(false)
    const scan = createFakeScan([{ exitCode: 0, stdout: "[]" }])
    _setScanSpawnForTesting(scan.spawn)

    //#when: a staged scan is requested
    const result = await runGitleaksStagedScan("/repo")

    //#then: no scan ran
    expect(result).toEqual({ available: false, findings: [] })
    expect(scan.calls()).toBe(0)
  })

  test("real git fingerprint changes only when staged content changes", async () => {
    //#given: a repository with a staged file and a stable scan result
    _setGitleaksAvailableForTesting(true)
    const scan = createFakeScan([{ exitCode: 0, stdout: "[]" }])
    _setScanSpawnForTesting(scan.spawn)
    const repo = mkdtempSync(join(tmpdir(), "gitleaks-fingerprint-"))
    try {
      runGit(repo, ["init", "-q"])
      writeFileSync(join(repo, "a.txt"), "first\n")
      runGit(repo, ["add", "a.txt"])

      //#when: the same staged set is scanned twice
      await runGitleaksStagedScan(repo)
      await runGitleaksStagedScan(repo)

      //#then: the second call reused the first scan
      expect(scan.calls()).toBe(1)

      //#when: new content is staged
      writeFileSync(join(repo, "a.txt"), "second\n")
      runGit(repo, ["add", "a.txt"])
      await runGitleaksStagedScan(repo)
      await runGitleaksStagedScan(repo)

      //#then: the changed blob set triggered exactly one new scan
      expect(scan.calls()).toBe(2)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
