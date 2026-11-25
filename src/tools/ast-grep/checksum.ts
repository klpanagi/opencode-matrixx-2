/**
 * Integrity verification for ast-grep release archives.
 *
 * Digests for known releases are pinned below (sourced from the GitHub release
 * API `digest` field). Unknown versions fall back to the release API. When no
 * digest can be resolved the archive is deleted and verification fails closed
 * with {@link ArchiveIntegrityError}; an unverified archive is never used.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync, unlinkSync } from "node:fs"

import { log } from "../../shared/runtime/logger"

const RELEASE_API = "https://api.github.com/repos/ast-grep/ast-grep/releases/tags"
const SHA256_PREFIX = "sha256:"
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export const PINNED_ASSET_SHA256: Readonly<Record<string, string>> = {
  "0.40.5/app-aarch64-apple-darwin.zip":
    "55c3a471a483daab49b6413972c3655087f2ce47335ab019067ed1fbf6672107",
  "0.40.5/app-aarch64-pc-windows-msvc.zip":
    "7613a619621b9afed5b0866232c56a314228eb1b9af407149d4a91b20c61eb05",
  "0.40.5/app-aarch64-unknown-linux-gnu.zip":
    "9596c2abfdf450203e5653e185d805133d5499f8c2cbb00b1aab54754ca70e13",
  "0.40.5/app-i686-pc-windows-msvc.zip":
    "c70899b658a8b7110612cf08152bfaa9a764637d8f7caa5aa7917fa18728f824",
  "0.40.5/app-x86_64-apple-darwin.zip":
    "4e1e6ae14aefb36a1a846bb6f1f951ca3f24895896161661c6cb589e0841fbd9",
  "0.40.5/app-x86_64-pc-windows-msvc.zip":
    "50a596ef5231883ddae69f1960d27312bb2fe81254d67ef50e1794fc9820e863",
  "0.40.5/app-x86_64-unknown-linux-gnu.zip":
    "9715cb5933a4d7fe9e4d8c2be870a9a82840c3f2ec4a57bdff7f15d0912cc676",
}

/**
 * Raised when an archive has no resolvable expected digest or its digest does
 * not match. The archive is deleted before this is thrown.
 */
export class ArchiveIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArchiveIntegrityError"
  }
}

interface GitHubReleaseAsset {
  name?: string
  digest?: string | null
}

interface GitHubRelease {
  assets?: GitHubReleaseAsset[]
}

export function computeSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

export function compareSha256Hex(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8")
  const actualBuffer = Buffer.from(actual, "utf8")
  // Different lengths cannot match; skip timingSafeEqual, which throws on a length mismatch.
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export async function resolveExpectedSha256(
  version: string,
  assetName: string
): Promise<string | null> {
  const pinned = PINNED_ASSET_SHA256[`${version}/${assetName}`]
  if (pinned) return pinned

  try {
    const response = await fetch(`${RELEASE_API}/${encodeURIComponent(version)}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (!response.ok) return null

    const release = (await response.json()) as GitHubRelease
    const asset = release.assets?.find((entry) => entry.name === assetName)
    return parseSha256Digest(asset?.digest)
  } catch {
    return null
  }
}

export async function verifyArchiveChecksum(
  archivePath: string,
  version: string,
  assetName: string
): Promise<void> {
  const expected = await resolveExpectedSha256(version, assetName)
  if (!expected) {
    if (existsSync(archivePath)) unlinkSync(archivePath)
    throw new ArchiveIntegrityError(
      `No checksum available for ${assetName}; refusing to use unverified archive`
    )
  }

  const actual = computeSha256(archivePath)
  if (compareSha256Hex(expected, actual)) {
    log(`[matrixx] Verified sha256 checksum for ${assetName}`)
    return
  }

  if (existsSync(archivePath)) unlinkSync(archivePath)
  throw new ArchiveIntegrityError(
    `ast-grep archive checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`
  )
}

function parseSha256Digest(digest: unknown): string | null {
  if (typeof digest !== "string") return null
  if (!digest.toLowerCase().startsWith(SHA256_PREFIX)) return null

  const hex = digest.slice(SHA256_PREFIX.length).toLowerCase()
  return SHA256_HEX_PATTERN.test(hex) ? hex : null
}
