import { lstat as lstatFs, readFile as readFileFs, realpath as realpathFs } from "node:fs/promises"
import { resolve } from "node:path"
import { isWithin } from "./path-containment"

export interface FileReferenceStats {
  isSymbolicLink(): boolean
  isDirectory(): boolean
  size: number
}

export interface FileReferenceFs {
  lstat(path: string): Promise<FileReferenceStats>
  realpath(path: string): Promise<string>
  readFile(path: string): Promise<string>
}

export interface ResolveFileReferencesOptions {
  cwd: string
  allowFileRefs?: boolean
  maxBytes?: number
  maxTotalBytes?: number
  fs?: FileReferenceFs
}

interface FileMatch {
  fullMatch: string
  filePath: string
}

interface ResolvedConfig {
  cwd: string
  allowFileRefs: boolean
  maxBytes: number
  maxTotalBytes: number
  fs: FileReferenceFs
}

interface ResolveState {
  totalBytes: number
  totalLimitHit: boolean
  markerAppended: boolean
}

type FileContentResult = { kind: "replacement"; replacement: string } | { kind: "leaveLiteral" }

const FILE_REFERENCE_PATTERN = /@([^\s@]+)/g

const DEFAULT_MAX_BYTES = 262144
const DEFAULT_MAX_TOTAL_BYTES = 1048576
const MAX_DEPTH = 3

const BLOCKED_DISABLED = "[blocked: file reference disabled for project-scope command]"
const BLOCKED_OUTSIDE = "[blocked: file reference outside workspace]"
const TOTAL_LIMIT_MARKER =
  "\n[file reference total size limit exceeded: remaining references left unresolved]"

function findFileReferences(text: string): FileMatch[] {
  const matches: FileMatch[] = []

  FILE_REFERENCE_PATTERN.lastIndex = 0

  for (let match = FILE_REFERENCE_PATTERN.exec(text); match !== null; match = FILE_REFERENCE_PATTERN.exec(text)) {
    matches.push({
      fullMatch: match[0],
      filePath: match[1],
    })
  }

  return matches
}

/**
 * Seam fakes throw plain `Error("ENOENT")` without a `code`, so detect both
 * shapes before classifying a realpath failure as missing.
 */
function isEnoentError(err: unknown): boolean {
  if ((err as { code?: unknown }).code === "ENOENT") return true
  return err instanceof Error && err.message.includes("ENOENT")
}

async function resolveFilePath(cfg: ResolvedConfig, filePath: string): Promise<string | null> {
  const resolved = resolve(cfg.cwd, filePath)
  if (!isWithin(cfg.cwd, resolved)) return null

  // A symlinked parent directory can carry the read outside the workspace even
  // when the leaf is a regular file — always canonicalise and re-check.
  let realTarget: string
  try {
    realTarget = await cfg.fs.realpath(resolved)
  } catch (err) {
    if (isEnoentError(err)) return resolved
    return null
  }

  let realRoot: string
  try {
    realRoot = await cfg.fs.realpath(cfg.cwd)
  } catch (err) {
    if (!isEnoentError(err)) return null
    realRoot = cfg.cwd
  }

  return isWithin(realRoot, realTarget) ? resolved : null
}

function withHardCap(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function defaultFs(): FileReferenceFs {
  return {
    lstat: lstatFs,
    realpath: realpathFs,
    readFile: (path) => readFileFs(path, "utf-8"),
  }
}

async function readFileContent(
  resolvedPath: string,
  cfg: ResolvedConfig,
  state: ResolveState,
): Promise<FileContentResult> {
  let stats: FileReferenceStats
  try {
    stats = await cfg.fs.lstat(resolvedPath)
  } catch {
    return { kind: "replacement", replacement: `[file not found: ${resolvedPath}]` }
  }

  if (stats.isDirectory()) {
    return { kind: "replacement", replacement: `[cannot read directory: ${resolvedPath}]` }
  }

  if (stats.size > cfg.maxBytes) {
    return { kind: "replacement", replacement: `[file too large: ${stats.size} bytes]` }
  }

  if (state.totalBytes + stats.size > cfg.maxTotalBytes) {
    state.totalLimitHit = true
    return { kind: "leaveLiteral" }
  }

  try {
    const content = await cfg.fs.readFile(resolvedPath)
    state.totalBytes += stats.size
    return { kind: "replacement", replacement: content }
  } catch {
    return { kind: "replacement", replacement: `[file not found: ${resolvedPath}]` }
  }
}

async function resolveReferences(
  text: string,
  cfg: ResolvedConfig,
  state: ResolveState,
  depth: number,
): Promise<string> {
  if (depth >= MAX_DEPTH) {
    return text
  }

  const matches = findFileReferences(text)
  if (matches.length === 0) {
    return text
  }

  const replacements = new Map<string, string>()

  for (const match of matches) {
    if (state.totalLimitHit) {
      break
    }

    if (!cfg.allowFileRefs) {
      replacements.set(match.fullMatch, BLOCKED_DISABLED)
      continue
    }

    const resolvedPath = await resolveFilePath(cfg, match.filePath)
    if (resolvedPath === null) {
      replacements.set(match.fullMatch, BLOCKED_OUTSIDE)
      continue
    }

    const result = await readFileContent(resolvedPath, cfg, state)
    if (result.kind === "leaveLiteral") {
      break
    }
    replacements.set(match.fullMatch, result.replacement)
  }

  let resolved = text
  for (const [pattern, replacement] of replacements.entries()) {
    resolved = resolved.split(pattern).join(replacement)
  }

  if (state.totalLimitHit && !state.markerAppended) {
    state.markerAppended = true
    resolved += TOTAL_LIMIT_MARKER
  }

  if (!state.totalLimitHit && findFileReferences(resolved).length > 0 && depth + 1 < MAX_DEPTH) {
    return resolveReferences(resolved, cfg, state, depth + 1)
  }

  return resolved
}

export async function resolveFileReferencesInText(
  text: string,
  options: ResolveFileReferencesOptions,
): Promise<string> {
  const cfg: ResolvedConfig = {
    cwd: options.cwd,
    allowFileRefs: options.allowFileRefs !== false,
    maxBytes: withHardCap(options.maxBytes, DEFAULT_MAX_BYTES),
    maxTotalBytes: withHardCap(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
    fs: options.fs ?? defaultFs(),
  }

  return resolveReferences(text, cfg, { totalBytes: 0, totalLimitHit: false, markerAppended: false }, 0)
}
