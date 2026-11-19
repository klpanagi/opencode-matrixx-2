/**
 * Subresource-integrity verification for third-party skill-pack tarballs (R14).
 *
 * Integrity strings are untrusted input. The parser accepts a whitespace-
 * separated SRI list, keeps only `sha512-` entries, ignores other algorithms,
 * and rejects syntactically invalid payloads. Errors never echo a digest:
 * mismatch errors report byte lengths only.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

const SHA512_PREFIX = "sha512-"
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/** Raised when an integrity string contains no usable `sha512-` entry. */
export class IntegrityFormatError extends Error {
  readonly code = "INTEGRITY_FORMAT"

  constructor(reason: string) {
    super(`Malformed integrity string: ${reason}`)
    this.name = "IntegrityFormatError"
  }
}

/** Raised when the tarball digest does not match any expected digest. */
export class IntegrityMismatchError extends Error {
  readonly code = "INTEGRITY_MISMATCH"

  constructor(
    readonly expectedLength: number,
    readonly actualLength: number,
  ) {
    super(
      `SHA-512 integrity mismatch: expected a ${expectedLength}-byte digest, computed a ${actualLength}-byte digest`,
    )
    this.name = "IntegrityMismatchError"
  }
}

/**
 * Returns the base64-encoded SHA-512 digest of `filePath`, matching the payload
 * of an SRI `sha512-<digest>` entry.
 */
export function computeSha512Base64(filePath: string): string {
  return createHash("sha512").update(readFileSync(filePath)).digest("base64")
}

/**
 * Verifies `tarballPath` against a space-separated SRI integrity list.
 *
 * Entries without the `sha512-` prefix are ignored, so a list may carry
 * digests for other algorithms. Verification passes when any sha512 entry
 * matches the file. A syntactically invalid sha512 payload, or a list with no
 * sha512 entry at all, raises {@link IntegrityFormatError}; a well-formed but
 * non-matching digest raises {@link IntegrityMismatchError}. The file is only
 * read, never written.
 */
export function verifySha512(tarballPath: string, integrity: string): void {
  const expectedDigests = parseSha512Integrity(integrity)
  const actualDigest = Buffer.from(computeSha512Base64(tarballPath), "base64")

  for (const expectedDigest of expectedDigests) {
    // Different lengths cannot match; skip timingSafeEqual, which throws on a length mismatch.
    if (expectedDigest.length !== actualDigest.length) continue
    if (timingSafeEqual(expectedDigest, actualDigest)) return
  }

  throw new IntegrityMismatchError(expectedDigests[0].length, actualDigest.length)
}

function parseSha512Integrity(integrity: string): Buffer[] {
  const entries = integrity.trim().split(/\s+/).filter((entry) => entry.length > 0)
  const digests: Buffer[] = []

  for (const entry of entries) {
    if (!entry.startsWith(SHA512_PREFIX)) continue
    const encoded = entry.slice(SHA512_PREFIX.length)
    if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
      throw new IntegrityFormatError("invalid sha512 base64 payload")
    }
    digests.push(Buffer.from(encoded, "base64"))
  }

  if (digests.length === 0) {
    throw new IntegrityFormatError('no "sha512-" entry found')
  }
  return digests
}
