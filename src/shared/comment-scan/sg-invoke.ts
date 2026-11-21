import { spawn } from "bun"

import { getAstGrepPath } from "../../tools/ast-grep/cli-binary-path-resolution"
import {
  DEFAULT_TIMEOUT_MS,
  getSgCliPath,
} from "../../tools/ast-grep/constants"
import { collectProcessOutputWithTimeout } from "../../tools/ast-grep/process-output-timeout"
import { sgSpawnEnv } from "../../tools/ast-grep/spawn-env"
import { DEFAULT_SG_TIMEOUT_MS, MAX_FILE_BYTES } from "./constants"
import type { InlineRuleSet } from "./types"

const MAX_SG_MATCHES = 500
// One match line embeds the comment text twice (`text` and `lines`) and JSON
// escaping can inflate it further; size the stdout cap so a full MAX_FILE_BYTES
// file still fits on one parseable line (2x the file cap + 1 MiB slack).
const MAX_SG_OUTPUT_BYTES = MAX_FILE_BYTES * 2 + 1024 * 1024
const MAX_SG_RETRIES = 8
const RETRY_BUDGET_MESSAGE = "retry budget exhausted; findings may be incomplete"
const VERSION_PROBE_TIMEOUT_MS = 5_000
const MALFORMED_LINE_PREVIEW = 120
const RULE_PARSE_PATTERN =
  /cannot parse rule|fail to parse yaml|invalid kind|not a valid ast-grep rule/i

export interface SgJsonByteOffset {
  readonly start: number
  readonly end: number
}

export interface SgJsonPosition {
  readonly line: number
  readonly column: number
}

export interface SgJsonRange {
  readonly byteOffset: SgJsonByteOffset
  readonly start: SgJsonPosition
  readonly end: SgJsonPosition
}

export interface SgJsonCharCount {
  readonly leading: number
  readonly trailing: number
}

export interface SgJsonMatch {
  readonly text: string
  readonly range: SgJsonRange
  readonly file: string
  readonly lines: string
  readonly charCount: SgJsonCharCount
  readonly language: string
  readonly ruleId: string
}

export interface SgScanRequest {
  readonly rules: InlineRuleSet
  readonly files: readonly string[]
  readonly cwd: string
  readonly timeoutMs?: number
  // Returns false when the caller's spawn budget is exhausted; every scan spawn,
  // including per-file retries, consults it first.
  readonly onSpawn?: () => boolean
}

export interface SgScanResult {
  readonly matches: SgJsonMatch[]
  readonly timedOut: boolean
  readonly stderr: string
  readonly truncated: boolean
}

export class SgUnavailableError extends Error {
  constructor(message = "ast-grep (sg) binary not found") {
    super(message)
    this.name = "SgUnavailableError"
  }
}

export function isRuleParseError(stderr: string): boolean {
  return RULE_PARSE_PATTERN.test(stderr)
}

export async function resolveSgBinary(
  spawnFn: typeof import("bun").spawn = spawn,
  candidates?: readonly string[],
): Promise<string> {
  const rejected = new Set<string>()

  if (candidates) {
    for (const candidate of candidates) {
      const usable = await trySgCandidate(candidate, spawnFn, rejected)
      if (usable) {
        return usable
      }
    }
  } else {
    const packagedCandidate = await trySgCandidate(findPackagedSgBinary(), spawnFn, rejected)
    if (packagedCandidate) {
      return packagedCandidate
    }

    const cachedCandidate = await trySgCandidate(getSgCliPath(), spawnFn, rejected)
    if (cachedCandidate) {
      return cachedCandidate
    }

    const resolvedCandidate = await trySgCandidate(await getAstGrepPath(), spawnFn, rejected)
    if (resolvedCandidate) {
      return resolvedCandidate
    }
  }

  throw new SgUnavailableError(
    `ast-grep (sg) binary not found: rejected ${rejected.size} candidate(s)`,
  )
}

interface RawSgRun {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly timedOut: boolean
}

interface ParsedSgAttempt {
  readonly matches: SgJsonMatch[]
  readonly malformed: string[]
  readonly truncated: boolean
}

async function invokeSg(
  command: string,
  request: SgScanRequest,
  files: readonly string[],
  spawnProcess: typeof import("bun").spawn,
  timeoutMs: number,
): Promise<RawSgRun | null> {
  if (request.onSpawn && !request.onSpawn()) return null

  const argv = [command, "scan", "--inline-rules", request.rules.yaml, "--json=stream", ...files]
  const child = spawnProcess(argv, {
    cwd: request.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: sgSpawnEnv(command),
  })

  try {
    const output = await collectProcessOutputWithTimeout(child, timeoutMs)
    return { stdout: output.stdout, stderr: output.stderr, exitCode: output.exitCode, timedOut: false }
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      return { stdout: "", stderr: "", exitCode: 0, timedOut: true }
    }
    throw error
  }
}

function parseSgAttempt(stdout: string): ParsedSgAttempt {
  const outputTruncated = stdout.length >= MAX_SG_OUTPUT_BYTES
  const parsed = parseSgStream(outputTruncated ? stdout.slice(0, MAX_SG_OUTPUT_BYTES) : stdout)
  const capped = parsed.matches.length > MAX_SG_MATCHES
  return {
    matches: capped ? parsed.matches.slice(0, MAX_SG_MATCHES) : parsed.matches,
    malformed: parsed.malformed,
    truncated: capped || outputTruncated,
  }
}

export async function runSgScan(
  request: SgScanRequest,
  spawnFn?: typeof import("bun").spawn,
): Promise<SgScanResult> {
  if (request.files.length === 0) {
    return { matches: [], timedOut: false, stderr: "", truncated: false }
  }

  const spawnProcess = spawnFn ?? spawn
  const command = await resolveSgBinary(spawnProcess)
  const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_SG_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)

  const first = await invokeSg(command, request, request.files, spawnProcess, timeoutMs)
  if (first === null) {
    return { matches: [], timedOut: false, stderr: "", truncated: false }
  }
  if (first.timedOut) {
    return { matches: [], timedOut: true, stderr: "", truncated: false }
  }

  const parsed = parseSgAttempt(first.stdout)
  if (isRuleParseError(first.stderr)) {
    return {
      matches: [],
      timedOut: false,
      stderr: joinDiagnostics(first.stderr, parsed.malformed),
      truncated: false,
    }
  }

  let matches = parsed.matches
  let malformed = parsed.malformed
  if (malformed.length > 0 && !parsed.truncated) {
    const matchedFiles = new Set(matches.map((match) => match.file))
    const missing = request.files.filter((file) => !matchedFiles.has(file))
    let recovered = false
    let retries = 0
    let retryBudgetExhausted = false
    for (const file of missing) {
      if (retries >= MAX_SG_RETRIES) break
      const retry = await invokeSg(command, request, [file], spawnProcess, timeoutMs)
      if (retry === null) {
        retryBudgetExhausted = true
        break
      }
      retries += 1
      if (retry.timedOut || isRuleParseError(retry.stderr)) continue
      const retryParsed = parseSgAttempt(retry.stdout)
      if (retryParsed.matches.length > 0) {
        matches = [...matches, ...retryParsed.matches]
        recovered = true
      }
    }
    if (retryBudgetExhausted) malformed = [RETRY_BUDGET_MESSAGE]
    else if (recovered && retries >= missing.length) malformed = []
  }

  return {
    matches,
    timedOut: false,
    stderr: joinDiagnostics(first.stderr, malformed),
    truncated: parsed.truncated,
  }
}

async function trySgCandidate(
  candidate: string | null,
  spawnFn: typeof import("bun").spawn,
  rejected: Set<string>,
): Promise<string | null> {
  if (!candidate || rejected.has(candidate)) {
    return null
  }

  if (await isUsableSgBinary(candidate, spawnFn)) {
    return candidate
  }

  rejected.add(candidate)
  return null
}

const usabilityProbes = new WeakMap<typeof spawn, Map<string, Promise<boolean>>>()

export function isUsableSgBinary(path: string, spawnFn: typeof import("bun").spawn): Promise<boolean> {
  let cache = usabilityProbes.get(spawnFn)
  if (!cache) {
    cache = new Map<string, Promise<boolean>>()
    usabilityProbes.set(spawnFn, cache)
  }

  const memoised = cache.get(path)
  if (memoised) {
    return memoised
  }

  const probe = probeSgBinary(path, spawnFn)
  cache.set(path, probe)
  return probe
}

async function probeSgBinary(path: string, spawnFn: typeof import("bun").spawn): Promise<boolean> {
  try {
    const child = spawnFn([path, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: sgSpawnEnv(path),
    })
    const output = await collectProcessOutputWithTimeout(child, VERSION_PROBE_TIMEOUT_MS)
    return output.exitCode === 0 && output.stdout.includes("ast-grep")
  } catch {
    return false
  }
}

export function findPackagedSgBinary(baseDir?: string): string | null {
  const bases = baseDir ? [baseDir] : [import.meta.dir, process.cwd()]

  for (const base of bases) {
    const resolved = resolveSgFromBase(base)
    if (resolved) {
      return resolved
    }
  }

  return null
}

function resolveSgFromBase(baseDir: string): string | null {
  try {
    return Bun.resolveSync("@ast-grep/cli/sg", baseDir)
  } catch {
    return null
  }
}

interface ParsedSgStream {
  readonly matches: SgJsonMatch[]
  readonly malformed: string[]
}

function parseSgStream(stdout: string): ParsedSgStream {
  const matches: SgJsonMatch[] = []
  const malformed: string[] = []
  const lines = stdout.split("\n")

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim()
    if (line.length === 0) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      malformed.push(describeMalformedLine(index + 1, line))
      continue
    }

    if (isSgJsonMatch(parsed)) {
      matches.push(parsed)
    } else {
      malformed.push(describeMalformedLine(index + 1, line))
    }
  }

  return { matches, malformed }
}

function isSgJsonMatch(value: unknown): value is SgJsonMatch {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.text === "string" &&
    typeof record.file === "string" &&
    typeof record.lines === "string" &&
    typeof record.language === "string" &&
    typeof record.ruleId === "string" &&
    typeof record.range === "object" &&
    record.range !== null &&
    typeof record.charCount === "object" &&
    record.charCount !== null
  )
}

function describeMalformedLine(lineNumber: number, line: string): string {
  return `Malformed sg output line ${lineNumber}: ${line.slice(0, MALFORMED_LINE_PREVIEW)}`
}

function joinDiagnostics(stderr: string, malformed: readonly string[]): string {
  const trimmed = stderr.trim()
  const parts = trimmed ? [trimmed, ...malformed] : [...malformed]
  return parts.join("\n")
}
