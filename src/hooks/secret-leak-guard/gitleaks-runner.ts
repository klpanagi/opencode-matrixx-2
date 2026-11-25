import { createHash } from "node:crypto"
import { log } from "../../shared"

interface GitleaksResult {
  available: boolean
  findings: GitleaksFinding[]
  error?: string
}

export interface GitleaksFinding {
  RuleID: string
  Match: string
  File: string
  StartLine: number
  EndLine: number
  Description: string
}

export interface GitleaksScanProcess {
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array>
  kill(): void
}

export type GitleaksScanSpawn = (
  args: string[],
  options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
) => GitleaksScanProcess

type StagedFingerprintFn = (cwd: string) => Promise<string | null>

interface StagedScanCacheEntry {
  fingerprint: string
  result: GitleaksResult
}

const GITLEAKS_FINGERPRINT_TIMEOUT_MS = 5_000
const GITLEAKS_STAGED_ARGS = [
  "detect",
  "--staged",
  "--report-format",
  "json",
  "--no-banner",
  "--exit-code",
  "0",
]

let gitleaksAvailable: boolean | null = null
const GITLEAKS_VERSION_TIMEOUT_MS = 5_000
const GITLEAKS_SCAN_TIMEOUT_MS = 30_000

async function checkGitleaksAvailable(): Promise<boolean> {
  if (gitleaksAvailable !== null) return gitleaksAvailable
  try {
    const proc = Bun.spawn(["gitleaks", "version"], { stdout: "pipe", stderr: "pipe" })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, GITLEAKS_VERSION_TIMEOUT_MS)
    )
    await Promise.race([proc.exited, timeout])
    gitleaksAvailable = true
  } catch {
    gitleaksAvailable = false
    log("[secret-leak-guard] gitleaks not found in PATH — secret scanning disabled")
  }
  return gitleaksAvailable
}

const defaultScanSpawn: GitleaksScanSpawn = (args, options) => {
  const proc = Bun.spawn(args, options)
  return { exited: proc.exited, stdout: proc.stdout, kill: () => proc.kill() }
}

let scanSpawn: GitleaksScanSpawn = defaultScanSpawn
let stagedFingerprint: StagedFingerprintFn = computeStagedFingerprint
const stagedScanCache = new Map<string, StagedScanCacheEntry>()

// Security-relevant identity: `gitleaks --staged` scans exactly this blob diff,
// so a stable hash means a repeated scan cannot observe different content.
async function computeStagedFingerprint(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "diff", "--cached", "--raw", "--no-abbrev", "-z"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, GITLEAKS_FINGERPRINT_TIMEOUT_MS)
    )
    const exitCode = await Promise.race([proc.exited, timeout])
    if (exitCode !== 0) return null
    const raw = await new Response(proc.stdout).arrayBuffer()
    return createHash("sha256").update(new Uint8Array(raw)).digest("hex")
  } catch {
    return null
  }
}

async function runGitleaksWithArgs(args: string[], cwd: string): Promise<GitleaksResult> {
  if (!await checkGitleaksAvailable()) {
    return { available: false, findings: [] }
  }
  try {
    const proc = scanSpawn(["gitleaks", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, GITLEAKS_SCAN_TIMEOUT_MS)
    )
    const exitCode = await Promise.race([proc.exited, timeout])
    if (exitCode === 0) {
      return { available: true, findings: [] }
    }
    const stdout = await new Response(proc.stdout).text()
    return parseGitleaksOutput(stdout, "")
  } catch {
    return { available: true, findings: [], error: "gitleaks timed out or failed to start" }
  }
}

export async function runGitleaksStagedScan(cwd: string): Promise<GitleaksResult> {
  if (!await checkGitleaksAvailable()) {
    return { available: false, findings: [] }
  }
  const fingerprint = await stagedFingerprint(cwd)
  if (fingerprint !== null) {
    const cached = stagedScanCache.get(cwd)
    if (cached !== undefined && cached.fingerprint === fingerprint) {
      return cached.result
    }
  }
  const result = await runGitleaksWithArgs(GITLEAKS_STAGED_ARGS, cwd)
  if (fingerprint !== null && result.error === undefined) {
    stagedScanCache.set(cwd, { fingerprint, result })
  }
  return result
}

export async function runGitleaksPrePushScan(cwd: string, remoteBranch: string): Promise<GitleaksResult> {
  return runGitleaksWithArgs(
    ["detect", "--log-opts", `${remoteBranch}..HEAD`, "--report-format", "json", "--no-banner", "--exit-code", "0"],
    cwd,
  )
}

function parseGitleaksOutput(stdout: string, stderr: string): GitleaksResult {
  try {
    const findings = JSON.parse(stdout) as GitleaksFinding[]
    if (Array.isArray(findings) && findings.length > 0) {
      return { available: true, findings }
    }
  } catch {
  }
  return { available: true, findings: [], error: stderr || "gitleaks exited with non-zero status" }
}

export function _setGitleaksAvailableForTesting(available: boolean | null): void {
  gitleaksAvailable = available
}

export function _setScanSpawnForTesting(spawn: GitleaksScanSpawn | null): void {
  scanSpawn = spawn ?? defaultScanSpawn
}

export function _setStagedFingerprintForTesting(fingerprint: StagedFingerprintFn | null): void {
  stagedFingerprint = fingerprint ?? computeStagedFingerprint
}

export function _resetGitleaksRunnerForTesting(): void {
  gitleaksAvailable = null
  scanSpawn = defaultScanSpawn
  stagedFingerprint = computeStagedFingerprint
  stagedScanCache.clear()
}
