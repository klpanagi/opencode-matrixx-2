import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve, sep } from "node:path"

import {
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  MAX_SCAN_FILES,
  oversizeMessage,
} from "./constants"
import { isAstLanguage, resolveLanguage } from "./language"
import { buildInlineRules } from "./rules"
import { isRuleParseError, runSgScan, type SgJsonMatch } from "./sg-invoke"
import type {
  AstLanguage,
  CommentFinding,
  InlineRuleSet,
  ScanOptions,
  ScanResult,
  ScanSource,
} from "./types"

const TEMP_DIR_PREFIX = "matrixx-comment-scan-"
const TEMP_DIR_MAX_AGE_MS = 60 * 60 * 1000
const TEMP_DIR_MODE = 0o700
const TEMP_FILE_MODE = 0o600
const SOURCE_STEM_LIMIT = 40
const RUST_DOC_COMMENT = /^\s*(?:\/\/\/|\/\/!)/

type ScanAstOptions = Required<Pick<ScanOptions, "timeoutMs" | "maxFindings">> & {
  readonly maxInvocations?: number
}
type SpawnFn = typeof import("bun").spawn

const AST_FILE_EXTENSIONS: Readonly<Record<AstLanguage, string>> = {
  python: ".py",
  javascript: ".js",
  typescript: ".ts",
  tsx: ".tsx",
  go: ".go",
  java: ".java",
  kotlin: ".kt",
  scala: ".scala",
  c: ".c",
  cpp: ".cpp",
  rust: ".rs",
  ruby: ".rb",
  bash: ".sh",
  csharp: ".cs",
  swift: ".swift",
  elixir: ".ex",
  lua: ".lua",
  php: ".php",
  html: ".html",
  css: ".css",
  yaml: ".yaml",
  nix: ".nix",
  haskell: ".hs",
  solidity: ".sol",
  json: ".json",
}

interface ResolvedSource {
  readonly text: string
  readonly filePath: string
  readonly language: AstLanguage
}

interface SourceGroup {
  readonly text: string
  readonly filePath: string
  readonly language: AstLanguage
  readonly byteLength: number
  readonly filePaths: readonly string[]
}

interface MaterializedFile {
  readonly path: string
  readonly language: AstLanguage
  readonly byteLength: number
  readonly filePaths: readonly string[]
}

export async function scanAstSources(
  sources: readonly ScanSource[],
  options: ScanAstOptions,
  spawnFn?: SpawnFn,
): Promise<ScanResult> {
  const resolved: ResolvedSource[] = []
  for (const source of sources) {
    const language = resolveLanguage(source.filePath)
    if (language && isAstLanguage(language)) {
      resolved.push({ text: source.text, filePath: source.filePath, language })
    }
  }

  if (resolved.length === 0) {
    const everySourceUnresolved =
      sources.length > 0 && sources.every((source) => resolveLanguage(source.filePath) === null)
    return everySourceUnresolved ? { findings: [], skipped: "unsupported" } : { findings: [] }
  }

  const errors: string[] = []
  const scannable = selectScannableSources(resolved, errors)
  if (scannable.length === 0) {
    return { findings: [], errors }
  }

  const tempDir = ensureTempDir()
  const scanToken = scanSequence
  scanSequence += 1

  const files = materializeSources(tempDir, scannable, scanToken)
  const rules = buildInlineRules(files.map((file) => file.language))
  const findings: CommentFinding[] = []
  let timedOut = false

  const invocationBudget = options.maxInvocations ?? MAX_SCAN_FILES
  let invocations = 0
  let budgetExhausted = false

  const scanChunk = async (chunk: readonly MaterializedFile[]): Promise<void> => {
    if (budgetExhausted || chunk.length === 0) return
    if (invocations >= invocationBudget) {
      budgetExhausted = true
      errors.push(
        `Scan stopped after ${invocationBudget} sg invocations; remaining findings were NOT scanned`,
      )
      return
    }
    const result = await runSgScan(
      {
        rules,
        files: chunk.map((file) => file.path),
        cwd: tempDir,
        timeoutMs: options.timeoutMs,
        onSpawn: () => {
          if (invocations >= invocationBudget) return false
          invocations += 1
          return true
        },
      },
      spawnFn,
    )

    if (result.timedOut) {
      timedOut = true
      errors.push(`sg timed out after ${options.timeoutMs}ms`)
      return
    }

    if (isRuleParseError(result.stderr)) {
      errors.push(result.stderr.trim())
      return
    }

    if (result.truncated && chunk.length > 1) {
      const middle = Math.ceil(chunk.length / 2)
      await scanChunk(chunk.slice(0, middle))
      await scanChunk(chunk.slice(middle))
      return
    }

    if (result.stderr.trim() !== "") {
      errors.push(result.stderr.trim())
    }

    if (result.truncated) {
      const file = chunk[0]
      if (file) {
        errors.push(
          `sg output truncated for ${file.filePaths.join(", ")}; findings are incomplete`,
        )
      }
    }

    findings.push(...mapMatches(chunk, result.matches, rules.ruleMeta, errors))
  }

  for (const chunk of chunkFiles(files)) {
    await scanChunk(chunk)
  }

  return {
    findings: sortFindings(findings, sources).slice(0, options.maxFindings),
    ...(errors.length > 0 ? { errors } : {}),
    ...(timedOut ? { skipped: "timeout" as const } : {}),
  }
}

function selectScannableSources(
  sources: readonly ResolvedSource[],
  errors: string[],
): readonly ResolvedSource[] {
  const selected: ResolvedSource[] = []
  for (const source of sources) {
    const byteLength = Buffer.byteLength(source.text, "utf8")
    if (byteLength > MAX_FILE_BYTES) {
      errors.push(oversizeMessage(source.filePath, byteLength))
      continue
    }
    selected.push(source)
  }
  return selected
}

function materializeSources(
  tempDir: string,
  sources: readonly ResolvedSource[],
  scanToken: number,
): readonly MaterializedFile[] {
  const groups = new Map<string, SourceGroup>()
  for (const source of sources) {
    const digest = createHash("sha256").update(source.text).digest("hex")
    const key = `${source.language}:${digest}`
    const existing = groups.get(key)
    if (existing) {
      groups.set(key, { ...existing, filePaths: [...existing.filePaths, source.filePath] })
      continue
    }
    groups.set(key, {
      text: source.text,
      filePath: source.filePath,
      language: source.language,
      byteLength: Buffer.byteLength(source.text, "utf8"),
      filePaths: [source.filePath],
    })
  }

  const files: MaterializedFile[] = []
  let index = 0
  for (const group of groups.values()) {
    const target = join(tempDir, tempFileName(scanToken, index, group.filePath, group.language))
    assertInsideTempDir(tempDir, target)
    writeFileSync(target, group.text, { mode: TEMP_FILE_MODE, flag: "wx" })
    files.push({
      path: target,
      language: group.language,
      byteLength: group.byteLength,
      filePaths: group.filePaths,
    })
    index += 1
  }
  return files
}

function tempFileName(
  scanToken: number,
  index: number,
  filePath: string,
  language: AstLanguage,
): string {
  return `src-${scanToken}-${index}-${sanitizeStem(filePath)}${AST_FILE_EXTENSIONS[language]}`
}

function sanitizeStem(filePath: string): string {
  const name = basename(filePath)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const safe = stem
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[.]+/, "")
    .slice(0, SOURCE_STEM_LIMIT)
  return safe === "" ? "source" : safe
}

function assertInsideTempDir(tempDir: string, target: string): void {
  if (!resolve(target).startsWith(resolve(tempDir) + sep)) {
    throw new Error("comment-scan temp file escaped its directory")
  }
}

function ensureTempDir(): string {
  if (processTempDir !== null) return processTempDir

  installSignalCleanupHandler()
  sweepStaleTempDirs()

  const dir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX))
  chmodSync(dir, TEMP_DIR_MODE)
  processTempDir = dir
  liveTempDirs.add(dir)
  tempDirCreations += 1
  return dir
}

const liveTempDirs = new Set<string>()
let processTempDir: string | null = null
let tempDirCreations = 0
let scanSequence = 0
let signalHandlerInstalls = 0
let signalHandlerInstalled = false

export function getSignalHandlerInstallCount(): number {
  return signalHandlerInstalls
}

export function getTempDirCreationCount(): number {
  return tempDirCreations
}

export function disposeCommentScanTempDir(): void {
  if (processTempDir === null) return
  removeTempDir(processTempDir)
  liveTempDirs.delete(processTempDir)
  processTempDir = null
}

function removeTempDir(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // best effort: the age sweep reclaims the directory on a later run
  }
}

function cleanupLiveTempDirs(): void {
  for (const tempDir of liveTempDirs) removeTempDir(tempDir)
  liveTempDirs.clear()
  processTempDir = null
}

function installSignalCleanupHandler(): void {
  if (signalHandlerInstalled) return
  signalHandlerInstalled = true
  signalHandlerInstalls += 1

  const handler = (signal: "SIGINT" | "SIGTERM"): void => {
    cleanupLiveTempDirs()
    process.off("SIGINT", handler)
    process.off("SIGTERM", handler)
    process.kill(process.pid, signal)
  }

  process.once("SIGINT", handler)
  process.once("SIGTERM", handler)
  process.once("exit", cleanupLiveTempDirs)
}

function sweepStaleTempDirs(now = Date.now()): void {
  const root = tmpdir()
  let entries: readonly string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.startsWith(TEMP_DIR_PREFIX)) {
      continue
    }
    const path = join(root, entry)
    try {
      if (now - statSync(path).mtimeMs < TEMP_DIR_MAX_AGE_MS) {
        continue
      }
      rmSync(path, { recursive: true, force: true })
    } catch {
      // best effort: a concurrently active batch keeps its directory
    }
  }
}

function chunkFiles(files: readonly MaterializedFile[]): readonly (readonly MaterializedFile[])[] {
  const chunks: MaterializedFile[][] = []
  let current: MaterializedFile[] = []
  let currentBytes = 0

  for (const file of files) {
    const wouldOverflowCount = current.length >= MAX_BATCH_FILES
    const wouldOverflowBytes =
      current.length > 0 && currentBytes + file.byteLength > MAX_BATCH_BYTES
    if (wouldOverflowCount || wouldOverflowBytes) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(file)
    currentBytes += file.byteLength
  }

  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

function mapMatches(
  files: readonly MaterializedFile[],
  matches: readonly SgJsonMatch[],
  ruleMeta: InlineRuleSet["ruleMeta"],
  errors: string[],
): readonly CommentFinding[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const findings: CommentFinding[] = []

  for (const match of matches) {
    const file =
      byPath.get(match.file) ??
      files.find((candidate) => basename(candidate.path) === basename(match.file))
    if (!file) {
      errors.push(`sg reported a match for an unknown file (${match.ruleId})`)
      continue
    }

    const meta = ruleMeta[match.ruleId]
    if (!meta) {
      errors.push(`sg reported an unknown rule ${match.ruleId}`)
      continue
    }

    const line = match.range.start.line + 1
    const trailing = /\S/.test(match.lines.slice(0, match.range.start.column))
    // Rust doc-comment nodes arrive with a trailing newline; every other
    // language's text is already newline-free and byte-exact in the baselines.
    const text =
      meta.language === "rust" && RUST_DOC_COMMENT.test(match.text)
        ? match.text.replace(/\r?\n$/, "")
        : match.text
    for (const filePath of file.filePaths) {
      findings.push({
        file: filePath,
        line,
        text,
        tier: "ast",
        isDocstring: meta.isDocstring,
        trailing,
        language: meta.language,
      })
    }
  }

  return findings
}

function sortFindings(
  findings: readonly CommentFinding[],
  sources: readonly ScanSource[],
): readonly CommentFinding[] {
  const order = new Map<string, number>()
  for (const [index, source] of sources.entries()) {
    if (!order.has(source.filePath)) {
      order.set(source.filePath, index)
    }
  }

  return [...findings].sort((left, right) => {
    const leftIndex = order.get(left.file) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = order.get(right.file) ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex || left.line - right.line
  })
}
