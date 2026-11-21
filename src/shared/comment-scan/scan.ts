import type { Dirent, Stats } from "node:fs"
import { lstat, readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import { DEFAULT_ALLOW_LIST } from "./allow-list"
import { scanAstSources } from "./ast-scan"
import {
  DEFAULT_MAX_FINDINGS,
  DEFAULT_QUEUE_CONCURRENCY,
  DEFAULT_QUEUE_MAX_PENDING,
  DEFAULT_SG_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_SCAN_BYTES,
  MAX_SCAN_FILES,
  oversizeMessage,
} from "./constants"
import { applyFilters, capFindings, normalizeCommentBody, subtractCompareText } from "./filter"
import { isAstLanguage, resolveLanguage } from "./language"
import { createBoundedQueue, QueueTimeoutError } from "./queue"
import { scanRegexSources } from "./regex-scan"
import { SgUnavailableError } from "./sg-invoke"
import type { BoundedQueue, CommentFinding, ScanOptions, ScanResult, ScanSource } from "./types"

type SpawnFn = typeof import("bun").spawn
type AstScanOptions = Required<Pick<ScanOptions, "timeoutMs" | "maxFindings">>

export type ScanTierSelection = "ast" | "regex" | "both"

export type AstScanFn = (
  sources: readonly ScanSource[],
  options: AstScanOptions,
  spawnFn?: SpawnFn,
) => Promise<ScanResult>

export type RegexScanFn = (
  sources: readonly ScanSource[],
  options?: ScanOptions,
  errors?: string[],
) => CommentFinding[] | Promise<CommentFinding[]>

export interface ScanSourcesOptions extends ScanOptions {
  readonly tier?: ScanTierSelection
  readonly queue?: BoundedQueue
  readonly spawn?: SpawnFn
  readonly scanAst?: AstScanFn
  readonly scanRegex?: RegexScanFn
}

export interface ScanPathsOptions extends ScanSourcesOptions {
  // Test-only override for the walker's total file cap (production: MAX_SCAN_FILES).
  readonly maxScanFiles?: number
  // Test-only override for the walker's total byte cap (production: MAX_SCAN_BYTES).
  readonly maxScanBytes?: number
}

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  ".matrixx",
  "build",
  ".next",
  "coverage",
  "vendor",
])

// Plan §4.4 says <=6; monorepos nest deeper than 6, so 12 is a deliberate
// deviation that keeps packages/*/src/** in scope while still bounding the walk.
const MAX_WALK_DEPTH = 12

interface CollectedFile {
  readonly filePath: string
  readonly absolutePath: string
  readonly byteLength: number
}

interface CollectionState {
  readonly files: CollectedFile[]
  readonly seenPaths: Set<string>
  readonly errors: string[]
  readonly maxFiles: number
  readonly maxBytes: number
  collectedBytes: number
  capped: boolean
  truncation: string | null
  depthTruncation: string | null
}

function isSkippedDirectory(name: string): boolean {
  // Broader than the plan's named set: every dot-directory is skipped, which is
  // safer (build caches, VCS metadata) and still leaves normal source trees visible.
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(name)
}

function addCandidate(state: CollectionState, filePath: string, byteLength: number): void {
  const absolutePath = resolve(filePath)
  if (state.seenPaths.has(absolutePath)) return
  state.seenPaths.add(absolutePath)

  if (byteLength > MAX_FILE_BYTES) {
    state.errors.push(oversizeMessage(filePath, byteLength))
    return
  }
  if (state.files.length >= state.maxFiles) {
    state.capped = true
    state.truncation = `Scan truncated: stopped after ${state.maxFiles} files (raise paths or narrow the scope); remaining files were NOT scanned`
    return
  }
  if (state.files.length > 0 && state.collectedBytes + byteLength > state.maxBytes) {
    state.capped = true
    state.truncation = `Scan truncated: stopped after ${state.maxBytes} bytes (raise paths or narrow the scope); remaining files were NOT scanned`
    return
  }
  state.files.push({ filePath, absolutePath, byteLength })
  state.collectedBytes += byteLength
}

async function collectDirectory(
  directory: string,
  depth: number,
  state: CollectionState,
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    state.errors.push(`Failed to read directory ${directory}: ${messageOf(error)}`)
    return
  }

  const sorted = [...entries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
  for (const entry of sorted) {
    if (state.capped) return
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_WALK_DEPTH && !isSkippedDirectory(entry.name)) {
        await collectDirectory(filePath, depth + 1, state)
      } else if (depth >= MAX_WALK_DEPTH && state.depthTruncation === null) {
        if (await directoryHasCandidate(filePath)) {
          state.depthTruncation = `Scan truncated: depth limit ${MAX_WALK_DEPTH} reached at ${filePath}; deeper files were NOT scanned`
        }
      }
      continue
    }
    if (entry.isSymbolicLink()) continue
    if (!entry.isFile()) continue
    if (resolveLanguage(entry.name) === null) continue
    try {
      const info = await stat(filePath)
      addCandidate(state, filePath, info.size)
    } catch (error) {
      state.errors.push(`Failed to stat ${filePath}: ${messageOf(error)}`)
    }
  }
}

async function collectPath(filePath: string, state: CollectionState): Promise<void> {
  let info: Stats
  try {
    info = await lstat(filePath)
  } catch (error) {
    state.errors.push(`Failed to stat ${filePath}: ${messageOf(error)}`)
    return
  }
  if (info.isDirectory()) {
    await collectDirectory(filePath, 0, state)
    return
  }
  if (!info.isFile()) {
    state.errors.push(`Skipped ${filePath}: not a regular file`)
    return
  }
  if (resolveLanguage(filePath) === null) return
  addCandidate(state, filePath, info.size)
}

async function directoryHasCandidate(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.some((entry) => entry.isFile() && resolveLanguage(entry.name) !== null)
  } catch {
    return false
  }
}

async function readCollectedFiles(
  files: readonly CollectedFile[],
  errors: string[],
): Promise<ScanSource[]> {
  const sources: ScanSource[] = []
  for (const file of files) {
    try {
      sources.push({ filePath: file.filePath, text: await readFile(file.absolutePath, "utf8") })
    } catch (error) {
      errors.push(`Failed to read ${file.filePath}: ${messageOf(error)}`)
    }
  }
  return sources
}

export async function scanPaths(
  paths: readonly string[],
  options: ScanPathsOptions = {},
): Promise<ScanResult> {
  const state: CollectionState = {
    files: [],
    seenPaths: new Set<string>(),
    errors: [],
    maxFiles: options.maxScanFiles ?? MAX_SCAN_FILES,
    maxBytes: options.maxScanBytes ?? MAX_SCAN_BYTES,
    collectedBytes: 0,
    capped: false,
    truncation: null,
    depthTruncation: null,
  }

  for (const path of paths) {
    if (state.capped) break
    await collectPath(path, state)
  }

  const sources = await readCollectedFiles(state.files, state.errors)
  const result = await scanSources(sources, options)
  const errors = [
    ...(state.truncation === null ? [] : [state.truncation]),
    ...(state.depthTruncation === null ? [] : [state.depthTruncation]),
    ...state.errors,
    ...(result.errors ?? []),
  ]
  if (errors.length === 0) return result
  if (result.skipped === "unsupported") {
    const { skipped: _skipped, ...rest } = result
    return { ...rest, errors }
  }
  return { ...result, errors }
}

type PartitionOutcome =
  | { readonly ok: true; readonly result: ScanResult }
  | { readonly ok: false; readonly error: unknown }

const defaultQueue = createBoundedQueue({
  concurrency: DEFAULT_QUEUE_CONCURRENCY,
  maxPending: DEFAULT_QUEUE_MAX_PENDING,
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settle<T>(
  promise: Promise<T>,
  wrap: (value: T) => ScanResult,
): Promise<PartitionOutcome> {
  return promise.then(
    (value) => ({ ok: true, result: wrap(value) }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )
}

function runAstPartition(
  queue: BoundedQueue,
  sources: readonly ScanSource[],
  astOptions: AstScanOptions,
  options: ScanSourcesOptions,
): Promise<PartitionOutcome> {
  const scan = options.scanAst ?? scanAstSources
  return settle(
    queue.run(() => scan(sources, astOptions, options.spawn)),
    (result) => result,
  )
}

function runRegexPartition(
  queue: BoundedQueue,
  sources: readonly ScanSource[],
  options: ScanSourcesOptions,
  errors: string[],
): Promise<PartitionOutcome> {
  const scan = options.scanRegex ?? scanRegexSources
  return settle(
    queue.run(async () => ({ findings: await scan(sources, options, errors) })),
    (result) => result,
  )
}

function locationKey(finding: CommentFinding): string {
  return `${finding.file}:${finding.line}:${normalizeCommentBody(finding.text)}`
}

function dropCrossTierDuplicates(findings: readonly CommentFinding[]): CommentFinding[] {
  const astLocations = new Set<string>()
  for (const finding of findings) {
    if (finding.tier === "ast") astLocations.add(locationKey(finding))
  }
  return findings.filter(
    (finding) => finding.tier === "ast" || !astLocations.has(locationKey(finding)),
  )
}

interface CompareSource {
  readonly compareText: string
  readonly normalizedText: string
  readonly lines: readonly string[]
}

function toCompareSource(source: ScanSource): CompareSource {
  return {
    compareText: source.compareText ?? "",
    normalizedText: normalizeCommentBody(source.text),
    lines: source.text.split(/\r?\n/),
  }
}

function ownsFinding(source: CompareSource, finding: CommentFinding, body: string): boolean {
  const lineText = source.lines[finding.line - 1] ?? ""
  if (normalizeCommentBody(lineText) === body) return true
  return body !== "" && source.normalizedText.includes(body)
}

function subtractCompareTextPerSource(
  findings: readonly CommentFinding[],
  sources: readonly ScanSource[],
): CommentFinding[] {
  const compareSourcesByFile = new Map<string, CompareSource[]>()
  for (const source of sources) {
    if (source.compareText === undefined || source.compareText === "") continue
    const bucket = compareSourcesByFile.get(source.filePath)
    if (bucket) bucket.push(toCompareSource(source))
    else compareSourcesByFile.set(source.filePath, [toCompareSource(source)])
  }
  if (compareSourcesByFile.size === 0) return [...findings]

  return findings.filter((finding) => {
    const candidates = compareSourcesByFile.get(finding.file)
    if (candidates === undefined || candidates.length === 0) return true

    const body = normalizeCommentBody(finding.text)
    const owning = candidates.filter((candidate) => ownsFinding(candidate, finding, body))
    const applicable = owning.length > 0 ? owning : candidates
    // Keep the finding when any candidate source does not treat it as pre-existing,
    // so one edit's old text cannot subtract another edit's new comment.
    return applicable.some(
      (candidate) => subtractCompareText([finding], candidate.compareText).length === 1,
    )
  })
}

function sortBySourceOrder(
  findings: readonly CommentFinding[],
  sources: readonly ScanSource[],
): CommentFinding[] {
  const order = new Map<string, number>()
  for (const [index, source] of sources.entries()) {
    if (!order.has(source.filePath)) order.set(source.filePath, index)
  }

  return [...findings].sort((left, right) => {
    const leftIndex = order.get(left.file) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = order.get(right.file) ?? Number.MAX_SAFE_INTEGER
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    if (left.file !== right.file) return left.file < right.file ? -1 : 1
    return left.line - right.line
  })
}

export async function scanSources(
  sources: readonly ScanSource[],
  options: ScanSourcesOptions = {},
): Promise<ScanResult> {
  const tier = options.tier ?? "both"
  const astSources: ScanSource[] = []
  const regexSources: ScanSource[] = []
  let resolved = 0

  for (const source of sources) {
    const language = resolveLanguage(source.filePath)
    if (language === null) continue
    resolved += 1
    if (isAstLanguage(language)) astSources.push(source)
    else regexSources.push(source)
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SG_TIMEOUT_MS
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS
  const queue = options.queue ?? defaultQueue
  const wantsAst = tier === "ast" || tier === "both"
  const wantsRegex = tier === "regex" || tier === "both"
  const findings: CommentFinding[] = []
  const errors: string[] = []

  const [astOutcome, regexOutcome] = await Promise.all([
    wantsAst && astSources.length > 0
      ? runAstPartition(queue, astSources, { timeoutMs, maxFindings }, options)
      : null,
    wantsRegex && regexSources.length > 0
      ? runRegexPartition(queue, regexSources, options, errors)
      : null,
  ])

  let timedOut = false
  let unavailable: string | null = null
  let astFindings = 0
  let astErrorCount = 0

  if (astOutcome) {
    if (astOutcome.ok) {
      astFindings = astOutcome.result.findings.length
      findings.push(...astOutcome.result.findings)
      if (astOutcome.result.skipped === "timeout") timedOut = true
      if (astOutcome.result.skipped === "binary-missing") {
        unavailable = "ast-grep (sg) binary not found"
      }
      if (astOutcome.result.errors) {
        errors.push(...astOutcome.result.errors)
        astErrorCount += astOutcome.result.errors.length
      }
    } else if (astOutcome.error instanceof QueueTimeoutError) {
      timedOut = true
    } else if (astOutcome.error instanceof SgUnavailableError) {
      unavailable = astOutcome.error.message
    } else {
      errors.push(messageOf(astOutcome.error))
      astErrorCount += 1
    }
  }

  if (regexOutcome) {
    if (regexOutcome.ok) {
      findings.push(...regexOutcome.result.findings)
      if (regexOutcome.result.skipped === "timeout") timedOut = true
      if (regexOutcome.result.errors) errors.push(...regexOutcome.result.errors)
    } else if (regexOutcome.error instanceof QueueTimeoutError) {
      timedOut = true
    } else {
      errors.push(messageOf(regexOutcome.error))
    }
  }

  const binaryMissing = unavailable !== null && astFindings === 0
  if (unavailable !== null && astFindings > 0 && astErrorCount === 0) {
    errors.push(unavailable)
  }
  if (astFindings === 0 && astErrorCount > 0) {
    errors.push(
      "AST tier produced no findings and reported errors; results may be incomplete",
    )
  }

  const filtered = applyFilters(findings, DEFAULT_ALLOW_LIST, findings.length)
  const decompared = subtractCompareTextPerSource(filtered.findings, sources)
  const deduped = dropCrossTierDuplicates(decompared)
  const sorted = sortBySourceOrder(deduped, sources)
  const cap = capFindings(sorted, maxFindings)
  const capped = cap.findings
  if (cap.truncated > 0) {
    errors.push(`Finding cap reached: showing ${capped.length} of ${sorted.length} findings`)
  }

  const excludedByTier =
    tier === "ast" ? regexSources.length : tier === "regex" ? astSources.length : 0
  if (capped.length === 0 && excludedByTier > 0) {
    errors.push(`tier "${tier}" excludes the ${excludedByTier} resolved source(s)`)
  }

  const skipped =
    timedOut
      ? "timeout"
      : binaryMissing
        ? "binary-missing"
        : resolved === 0 && capped.length === 0 && errors.length === 0
          ? "unsupported"
          : undefined

  return {
    findings: capped,
    ...(errors.length > 0 ? { errors } : {}),
    ...(skipped !== undefined ? { skipped } : {}),
  }
}
