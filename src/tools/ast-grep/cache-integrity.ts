import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"

import { log, warn } from "../../shared/runtime/logger"
import { compareSha256Hex, computeSha256 } from "./checksum"

const SIDECAR_SUFFIX = ".sha256"

export function getChecksumSidecarPath(binaryPath: string): string {
  return `${binaryPath}${SIDECAR_SUFFIX}`
}

export function writeCachedChecksum(binaryPath: string): void {
  try {
    writeFileSync(getChecksumSidecarPath(binaryPath), `${computeSha256(binaryPath)}\n`)
  } catch {
    warn(`Could not write checksum sidecar for ${binaryPath}; the binary cannot be verified later`)
  }
}

export function verifyCachedBinary(binaryPath: string): boolean {
  if (!existsSync(binaryPath)) return false

  let expected: string
  try {
    expected = readFileSync(getChecksumSidecarPath(binaryPath), "utf8").trim()
  } catch (err) {
    if (isMissingFileError(err)) {
      invalidateCachedBinary(binaryPath)
      return false
    }
    warn(`Could not read checksum sidecar for ${binaryPath}; proceeding unverified`)
    return true
  }

  let actual: string
  try {
    actual = computeSha256(binaryPath)
  } catch {
    invalidateCachedBinary(binaryPath)
    return false
  }

  if (compareSha256Hex(expected, actual)) return true

  invalidateCachedBinary(binaryPath)
  return false
}

function invalidateCachedBinary(binaryPath: string): void {
  log(`[matrixx] cached sg binary failed integrity check; re-downloading`)
  removeFile(binaryPath)
  removeFile(getChecksumSidecarPath(binaryPath))
}

function removeFile(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    warn(`Could not remove ${filePath}; the cache directory may be read-only`)
  }
}

function isMissingFileError(err: unknown): boolean {
  return (err as { code?: unknown }).code === "ENOENT"
}
