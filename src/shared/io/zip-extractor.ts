import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { release } from "node:os"
import { resolve } from "node:path"

import { type Subprocess, spawn, spawnSync } from "bun"

import { isWithin } from "./path-containment"

const WINDOWS_BUILD_WITH_TAR = 17134
const LIST_TIMEOUT_MS = 30_000

/** DoS caps: refuse archives that declare too many members or too many uncompressed bytes. */
export const MAX_ZIP_MEMBERS = 10_000
export const MAX_ZIP_UNCOMPRESSED_BYTES = 536_870_912
const EXTRACTION_TIMEOUT_MS = 30_000

/**
 * Raised when an archive cannot be proved safe to extract: unreadable listing,
 * no members, absolute or traversing member paths, symlink members, or a target
 * that escapes the destination after extraction.
 */
export class UnsafeZipEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeZipEntryError"
  }
}

export interface ZipEntryInfo {
  /** Member path exactly as stored in the archive. */
  name: string
  /** Unix mode string (e.g. `-rw-r--r--`, `lrwxrwxrwx`, `drwxr-xr-x`); `null` when unknown. */
  mode: string | null
  /** Declared uncompressed size in bytes; absent when the listing format cannot provide it (tar fallback). */
  uncompressedSize?: number | null
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function getWindowsBuildNumber(): number | null {
  if (process.platform !== "win32") return null

  const parts = release().split(".")
  if (parts.length >= 3) {
    const build = parseInt(parts[2], 10)
    if (!Number.isNaN(build)) return build
  }
  return null
}

function isPwshAvailable(): boolean {
  if (process.platform !== "win32") return false
  const result = spawnSync(["where", "pwsh"], { stdout: "pipe", stderr: "pipe" })
  return result.exitCode === 0
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''")
}

type WindowsZipExtractor = "tar" | "pwsh" | "powershell"

function getWindowsZipExtractor(): WindowsZipExtractor {
  const buildNumber = getWindowsBuildNumber()

  if (buildNumber !== null && buildNumber >= WINDOWS_BUILD_WITH_TAR) {
    return "tar"
  }

  if (isPwshAvailable()) {
    return "pwsh"
  }

  return "powershell"
}

async function runCommand(command: string[], timeoutMs = LIST_TIMEOUT_MS): Promise<CommandResult> {
  const proc: Subprocess<"ignore", "pipe", "pipe"> = spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  })

  const exitCode = await proc.exited
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array<ArrayBuffer>>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array<ArrayBuffer>>).text(),
  ])

  return { exitCode, stdout, stderr }
}

/** Parse `unzip -Z1` output into raw member names (one per line). */
export function parseZipNameListing(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.length > 0)
}

/**
 * Parse `unzip -Z` (zipinfo long format) output into entries with their mode.
 * The name is whatever follows the seven metadata columns; unparseable lines
 * are skipped, and callers cross-check the count against `-Z1` so a skipped
 * line fails closed instead of silently passing.
 */
export function parseUnzipLongListing(output: string): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = []

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = /^([-dl?][rwxsStT-]{9})\s+(.*)$/.exec(line)
    if (!match) continue

    const rawMode = match[1]
    // zipinfo long format columns after the mode: version, os, size, type, method, date, time, name.
    const sizedMatch = /^(\S+)\s+(\S+)\s+(\d+)\s+(?:\S+\s+){4}(.*)$/.exec(match[2])
    if (sizedMatch) {
      entries.push({
        name: sizedMatch[4],
        mode: rawMode.startsWith("?") ? null : rawMode,
        uncompressedSize: Number(sizedMatch[3]),
      })
      continue
    }

    const nameMatch = /^(?:\S+\s+){7}(.*)$/.exec(match[2])
    if (!nameMatch) continue

    entries.push({
      name: nameMatch[1],
      mode: rawMode.startsWith("?") ? null : rawMode,
    })
  }

  return entries
}

/**
 * Parse `tar -tvf` output (bsdtar/GNU tar) into entries with their mode. Used
 * only on Windows, where `unzip` may be absent. Lines that do not carry a
 * recognizable mode are skipped.
 */
export function parseTarLongListing(output: string): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = []
  const stamp =
    /^([-dl?][rwxsStT-]{9})\s+.+?(?:\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})\s+(.*)$/

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = stamp.exec(line)
    if (!match) continue

    const rawMode = match[1]
    entries.push({
      name: match[2],
      mode: rawMode.startsWith("?") ? null : rawMode,
    })
  }

  return entries
}

function assertListingSucceeded(result: CommandResult, archivePath: string, command: string): void {
  if (result.exitCode === 0) return
  const detail = result.stderr.trim() || `exit ${result.exitCode}`
  throw new UnsafeZipEntryError(
    `cannot list archive ${archivePath} with ${command}; refusing to extract: ${detail}`
  )
}

async function listEntriesWithUnzip(archivePath: string): Promise<ZipEntryInfo[]> {
  const namesResult = await runCommand(["unzip", "-Z1", "--", archivePath])
  assertListingSucceeded(namesResult, archivePath, "unzip -Z1")

  const detailsResult = await runCommand(["unzip", "-Z", "--", archivePath])
  assertListingSucceeded(detailsResult, archivePath, "unzip -Z")

  const names = parseZipNameListing(namesResult.stdout)
  const details = parseUnzipLongListing(detailsResult.stdout)

  if (names.length !== details.length) {
    throw new UnsafeZipEntryError(
      `cannot determine file modes for ${archivePath}: ${names.length} names vs ${details.length} detailed entries; refusing to extract`
    )
  }

  return names.map((name, index) => ({
    name,
    mode: details[index]?.mode ?? null,
    uncompressedSize: details[index]?.uncompressedSize ?? null,
  }))
}

async function listEntriesWithTar(archivePath: string): Promise<ZipEntryInfo[]> {
  const result = await runCommand(["tar", "-tvf", archivePath])
  assertListingSucceeded(result, archivePath, "tar -tvf")
  return parseTarLongListing(result.stdout)
}

async function listZipEntries(archivePath: string): Promise<ZipEntryInfo[]> {
  try {
    return await listEntriesWithUnzip(archivePath)
  } catch (error) {
    if (process.platform !== "win32") throw error
  }

  try {
    return await listEntriesWithTar(archivePath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new UnsafeZipEntryError(
      `cannot validate archive ${archivePath} on win32; refusing unvalidated extraction: ${reason}`
    )
  }
}

/**
 * Reject any member whose path could write outside `destDir`, including
 * absolute paths, drive-letter paths, `..` segments (POSIX or backslash),
 * NUL bytes, symlinks, and unknown modes.
 */
export function validateZipEntries(entries: readonly ZipEntryInfo[], destDir: string): void {
  if (entries.length === 0) {
    throw new UnsafeZipEntryError("archive contains no entries; refusing to extract")
  }

  const resolvedDest = resolve(destDir)

  for (const entry of entries) {
    const { name, mode } = entry

    if (name.length === 0) {
      throw new UnsafeZipEntryError("archive contains an empty entry name; refusing to extract")
    }

    if (name.includes("\0")) {
      throw new UnsafeZipEntryError("archive entry contains a NUL byte; refusing to extract")
    }

    if (mode === null) {
      throw new UnsafeZipEntryError(
        `cannot determine file mode for archive entry ${JSON.stringify(name)}; refusing to extract`
      )
    }

    if (mode.startsWith("l")) {
      throw new UnsafeZipEntryError(
        `archive entry ${JSON.stringify(name)} is a symlink; refusing to extract`
      )
    }

    const normalized = name.replace(/\\/g, "/")

    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      throw new UnsafeZipEntryError(
        `archive entry ${JSON.stringify(name)} is an absolute path; refusing to extract`
      )
    }

    if (normalized.split("/").includes("..")) {
      throw new UnsafeZipEntryError(
        `archive entry ${JSON.stringify(name)} escapes the destination via '..'; refusing to extract`
      )
    }

    const target = resolve(resolvedDest, normalized)
    if (!isWithin(resolvedDest, target)) {
      throw new UnsafeZipEntryError(
        `archive entry ${JSON.stringify(name)} resolves outside the destination; refusing to extract`
      )
    }
  }
}

function verifyExtractedTargets(entries: readonly ZipEntryInfo[], destDir: string): void {
  const realDest = realpathSync(resolve(destDir))

  for (const entry of entries) {
    const normalized = entry.name.replace(/\\/g, "/").replace(/\/+$/, "")
    if (normalized.length === 0) continue

    const target = resolve(realDest, normalized)
    let stats: ReturnType<typeof lstatSync>
    try {
      stats = lstatSync(target)
    } catch {
      throw new UnsafeZipEntryError(
        `extracted entry ${JSON.stringify(entry.name)} is missing after extraction; refusing to keep extraction`
      )
    }

    if (stats.isSymbolicLink()) {
      throw new UnsafeZipEntryError(
        `extracted entry ${JSON.stringify(entry.name)} is a symlink; refusing to keep extraction`
      )
    }

    const realTarget = realpathSync(target)
    if (!isWithin(realDest, realTarget)) {
      throw new UnsafeZipEntryError(
        `extracted entry ${JSON.stringify(entry.name)} resolves outside the destination; refusing to keep extraction`
      )
    }
  }
}

/**
 * Post-extraction DoS guard: declared sizes can lie, so after a successful
 * extract, sum the actual on-disk bytes of the extracted tree and refuse (and
 * remove the payload) when the total exceeds the cap. The walk uses lstat only
 * and never follows symlinks, so a planted link can neither loop the walk nor
 * hide its target's size from the total.
 */
export function verifyExtractedTotalSize(destDir: string, maxBytes: number): void {
  const root = resolve(destDir)
  let total = 0

  const stack: string[] = [root]
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    let stats: ReturnType<typeof lstatSync>
    try {
      stats = lstatSync(current)
    } catch {
      throw new UnsafeZipEntryError(
        `extracted entry ${JSON.stringify(current)} disappeared during byte-cap verification; refusing to keep extraction`
      )
    }

    if (stats.isDirectory()) {
      let children: string[]
      try {
        children = readdirSync(current)
      } catch {
        throw new UnsafeZipEntryError(
          `cannot read extracted directory ${JSON.stringify(current)} during byte-cap verification; refusing to keep extraction`
        )
      }
      for (const child of children) {
        stack.push(resolve(current, child))
      }
      continue
    }
    total += stats.size
  }

  if (total <= maxBytes) return

  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  throw new UnsafeZipEntryError(
    `extraction wrote ${total} bytes under ${root}, exceeding the maximum of ${maxBytes}; the extracted payload has been removed`
  )
}

/**
 * DoS guard: refuse archives that declare too many members or too many total
 * uncompressed bytes, before any extraction happens. The size check is fail
 * closed: when a listing cannot establish a member's declared size (the tar
 * fallback never can; a malformed zipinfo row may not), the cap cannot be
 * verified, so the archive is refused outright. Declared sizes can also lie,
 * so a post-extraction byte check (verifyExtractedTotalSize) still runs.
 */
export function assertArchiveSizeCaps(entries: readonly ZipEntryInfo[], archivePath: string): void {
  if (entries.length > MAX_ZIP_MEMBERS) {
    throw new UnsafeZipEntryError(
      `archive ${archivePath} contains ${entries.length} members, exceeding the maximum of ${MAX_ZIP_MEMBERS}; refusing to extract`
    )
  }

  let declaredTotal = 0
  for (const entry of entries) {
    if (typeof entry.uncompressedSize !== "number") {
      throw new UnsafeZipEntryError(
        `cannot establish the declared uncompressed size for archive ${archivePath} (member ${JSON.stringify(entry.name)}); refusing to extract: the ${MAX_ZIP_UNCOMPRESSED_BYTES}-byte cap cannot be verified`
      )
    }
    declaredTotal += entry.uncompressedSize
  }
  if (declaredTotal > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new UnsafeZipEntryError(
      `archive ${archivePath} declares ${declaredTotal} uncompressed bytes across members, exceeding the maximum of ${MAX_ZIP_UNCOMPRESSED_BYTES}; refusing to extract`
    )
  }
}

export async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const entries = await listZipEntries(archivePath)
  assertArchiveSizeCaps(entries, archivePath)
  validateZipEntries(entries, destDir)

  let proc: Subprocess

  if (process.platform === "win32") {
    const extractor = getWindowsZipExtractor()

    switch (extractor) {
      case "tar":
        proc = spawn(["tar", "-xf", archivePath, "-C", destDir], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
      case "pwsh":
        proc = spawn(["pwsh", "-Command", `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
      default:
        proc = spawn(["powershell", "-Command", `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
    }
  } else {
    proc = spawn(["unzip", "-o", "-qq", "--", archivePath, "-d", destDir], {
      stdout: "ignore",
      stderr: "pipe",
    })
  }

  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, EXTRACTION_TIMEOUT_MS)
  const exitCode = await proc.exited
  clearTimeout(timeoutId)

  if (timedOut) {
    throw new UnsafeZipEntryError(
      `zip extraction of ${archivePath} timed out after ${EXTRACTION_TIMEOUT_MS}ms; refusing to keep extraction`
    )
  }

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array<ArrayBuffer>>).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }

  verifyExtractedTargets(entries, destDir)
  verifyExtractedTotalSize(destDir, MAX_ZIP_UNCOMPRESSED_BYTES)
}
