/**
 * Minimal, hardened tar extractor for third-party skill packs (T2.3).
 *
 * A pack archive is untrusted input. We only read ustar/PAX/GNU headers with
 * plain `zlib.gunzipSync` (no `tar` binary, no dependency), accept regular
 * files and directories only, and refuse anything that could escape the
 * destination: absolute paths, `..` segments, and links.
 *
 * Only `package/assets/**` survives extraction, stripped to `assets/**` — the
 * pack's `dist/`, `package.json` and docs are never written to disk.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { gunzipSync } from "node:zlib"

const BLOCK_SIZE = 512
const NAME_OFFSET = 0
const NAME_LENGTH = 100
const SIZE_OFFSET = 124
const SIZE_LENGTH = 12
const TYPEFLAG_OFFSET = 156
const PREFIX_OFFSET = 345
const PREFIX_LENGTH = 155
const BASE_256_FLAG = 0x80
const NUL_BYTE = 0

const REGULAR_FILE_TYPEFLAG = "0"
const DIRECTORY_TYPEFLAG = "5"
const GNU_LONG_NAME_TYPEFLAG = "L"
const PAX_EXTENDED_TYPEFLAG = "x"
const PAX_GLOBAL_TYPEFLAG = "g"

const PACKAGE_PREFIX = "package/"
const PACKAGE_ASSETS_PATH = "package/assets"
const PACKAGE_ASSETS_PREFIX = "package/assets/"

const UNSAFE_TAR_ENTRY_CODE = "UNSAFE_TAR_ENTRY"

/** One parsed tar member: the effective name, its type, size and payload. */
export type TarEntry = {
  name: string
  typeflag: string
  size: number
  data: Buffer
}

export type ExtractTarballOptions = {
  /** Called with the stripped `assets/...` path; return false to skip the entry. */
  filter?: (relativePath: string) => boolean
}

export type ExtractTarballResult = {
  /** Stripped relative paths that were actually written. */
  files: string[]
}

/** Raised when an archive member would resolve outside the destination root. */
export class UnsafeTarEntryError extends Error {
  readonly code: string = UNSAFE_TAR_ENTRY_CODE
  readonly entryPath: string

  constructor(entryPath: string) {
    super(`unsafe tar entry rejected: ${entryPath}`)
    this.name = "UnsafeTarEntryError"
    this.entryPath = entryPath
  }
}

type PlannedEntry = {
  relativePath: string
  target: string
  typeflag: string
  data: Buffer
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length)
  const terminator = slice.indexOf(NUL_BYTE)
  return (terminator === -1 ? slice : slice.subarray(0, terminator)).toString("utf8")
}

function readSize(buffer: Buffer, offset: number, length: number): number {
  const first = buffer[offset] ?? 0

  // GNU base-256 encoding for sizes that do not fit the octal field.
  if ((first & BASE_256_FLAG) !== 0) {
    let value = first & (BASE_256_FLAG - 1)
    for (let index = 1; index < length; index += 1) {
      value = value * 256 + (buffer[offset + index] ?? 0)
    }
    return value
  }

  const text = readString(buffer, offset, length).trim()
  if (!text) return 0
  const parsed = Number.parseInt(text, 8)
  return Number.isNaN(parsed) ? 0 : parsed
}

function normalizeTypeflag(raw: number | undefined): string {
  // A NUL typeflag is the classic encoding of a regular file.
  if (raw === undefined || raw === NUL_BYTE) return REGULAR_FILE_TYPEFLAG
  return String.fromCharCode(raw)
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false
  }
  return true
}

function readPaxPath(payload: Buffer): string | null {
  const text = payload.toString("utf8")
  let cursor = 0

  while (cursor < text.length) {
    const space = text.indexOf(" ", cursor)
    if (space === -1) return null
    const recordLength = Number.parseInt(text.slice(cursor, space), 10)
    if (!Number.isFinite(recordLength) || recordLength <= 0) return null

    // A record is "<len> <key>=<value>\n"; the length covers the whole record.
    const record = text.slice(space + 1, cursor + recordLength - 1)
    const separator = record.indexOf("=")
    if (separator !== -1 && record.slice(0, separator) === "path") {
      return record.slice(separator + 1)
    }
    cursor += recordLength
  }

  return null
}

/**
 * Parse an uncompressed tar buffer into entries, stopping at the two zero
 * blocks that terminate an archive. GNU long names (`L`) and PAX `path`
 * overrides (`x`) are applied to the entry that follows them.
 */
export function parseTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let zeroBlocks = 0
  let pendingLongName: string | null = null
  let pendingPaxPath: string | null = null

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE)

    if (isZeroBlock(header)) {
      zeroBlocks += 1
      if (zeroBlocks >= 2) break
      offset += BLOCK_SIZE
      continue
    }
    zeroBlocks = 0

    const size = readSize(header, SIZE_OFFSET, SIZE_LENGTH)
    const typeflag = normalizeTypeflag(header[TYPEFLAG_OFFSET])
    const dataStart = offset + BLOCK_SIZE
    const dataEnd = Math.min(dataStart + size, buffer.length)
    const data = buffer.subarray(dataStart, dataEnd)

    if (typeflag === GNU_LONG_NAME_TYPEFLAG) {
      pendingLongName = readString(data, 0, data.length)
    } else if (typeflag === PAX_EXTENDED_TYPEFLAG) {
      pendingPaxPath = readPaxPath(data) ?? pendingPaxPath
    } else if (typeflag === PAX_GLOBAL_TYPEFLAG) {
      // Global PAX headers carry no member of their own.
    } else {
      const rawName = readString(header, NAME_OFFSET, NAME_LENGTH)
      const prefix = readString(header, PREFIX_OFFSET, PREFIX_LENGTH)
      const headerName = prefix ? `${prefix}/${rawName}` : rawName
      entries.push({
        name: pendingPaxPath ?? pendingLongName ?? headerName,
        typeflag,
        size,
        data,
      })
      pendingPaxPath = null
      pendingLongName = null
    }

    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE
  }

  return entries
}

function toPosixSeparators(entryPath: string): string {
  return entryPath.replace(/\\/g, "/")
}

function isAbsoluteEntryPath(posixPath: string): boolean {
  return posixPath.startsWith("/") || /^[A-Za-z]:/.test(posixPath)
}

/** True when the entry name is absolute, NUL-bearing, or escapes its root. */
function isUnsafeEntryPath(name: string): boolean {
  if (name.includes("\0")) return true
  const unified = toPosixSeparators(name)
  if (isAbsoluteEntryPath(unified)) return true
  // Reject `..` outright: a legitimate pack member never climbs out of its tree,
  // and that segment is what lets a stripped path escape the destination root.
  if (unified.split("/").includes("..")) return true
  const normalized = path.posix.normalize(unified)
  return isAbsoluteEntryPath(normalized)
}

/** `package/assets/...` → `assets/...`; null for anything outside the assets tree. */
function toAssetsRelativePath(normalizedName: string): string | null {
  if (normalizedName === PACKAGE_ASSETS_PATH) return "assets"
  if (!normalizedName.startsWith(PACKAGE_ASSETS_PREFIX)) return null
  return normalizedName.slice(PACKAGE_PREFIX.length)
}

function resolveWithin(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new UnsafeTarEntryError(relativePath)
  }
  return target
}

/**
 * Extract `package/assets/**` from a `.tgz` archive into `destDir`.
 *
 * Every member is validated before anything is written, so an unsafe archive
 * leaves the destination untouched. Symlinks, hardlinks and device nodes are
 * ignored; `filter` receives stripped `assets/...` paths.
 */
export function extractTarball(
  tgzPath: string,
  destDir: string,
  options: ExtractTarballOptions = {},
): ExtractTarballResult {
  const archive = gunzipSync(readFileSync(tgzPath))
  const root = path.resolve(destDir)
  const planned: PlannedEntry[] = []

  for (const entry of parseTar(archive)) {
    if (entry.typeflag !== REGULAR_FILE_TYPEFLAG && entry.typeflag !== DIRECTORY_TYPEFLAG) {
      // Symlinks, hardlinks, character/block devices and FIFOs are never followed.
      continue
    }
    if (isUnsafeEntryPath(entry.name)) throw new UnsafeTarEntryError(entry.name)

    const normalizedName = path.posix.normalize(toPosixSeparators(entry.name))
    const relativePath = toAssetsRelativePath(normalizedName)
    if (relativePath === null) continue
    if (options.filter && !options.filter(relativePath)) continue

    planned.push({
      relativePath,
      target: resolveWithin(root, relativePath),
      typeflag: entry.typeflag,
      data: entry.data,
    })
  }

  const files: string[] = []
  for (const entry of planned) {
    if (entry.typeflag === DIRECTORY_TYPEFLAG) {
      mkdirSync(entry.target, { recursive: true })
      continue
    }
    mkdirSync(path.dirname(entry.target), { recursive: true })
    writeFileSync(entry.target, entry.data)
    files.push(entry.relativePath)
  }

  return { files }
}
