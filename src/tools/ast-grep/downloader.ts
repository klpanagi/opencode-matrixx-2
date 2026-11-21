import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  cleanupArchive,
  downloadArchive,
  ensureCacheDir,
  ensureExecutable,
  extractZipArchive,
  getCachedBinaryPath as getCachedBinaryPathShared,
} from "../../shared/io/binary-downloader"
import { log } from "../../shared/runtime/logger"
import { getChecksumSidecarPath, verifyCachedBinary, writeCachedChecksum } from "./cache-integrity"
import { verifyArchiveChecksum } from "./checksum"

const REPO = "ast-grep/ast-grep"

// IMPORTANT: Keep this in sync with the installed @ast-grep/cli version.
// Only used as fallback when @ast-grep/cli/package.json cannot be read.
export const DEFAULT_VERSION = "0.40.5"

function getAstGrepVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("@ast-grep/cli/package.json")
    return pkg.version
  } catch {
    return DEFAULT_VERSION
  }
}

interface PlatformInfo {
  arch: string
  os: string
}

export const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { arch: "aarch64", os: "apple-darwin" },
  "darwin-x64": { arch: "x86_64", os: "apple-darwin" },
  "linux-arm64": { arch: "aarch64", os: "unknown-linux-gnu" },
  "linux-x64": { arch: "x86_64", os: "unknown-linux-gnu" },
  "win32-x64": { arch: "x86_64", os: "pc-windows-msvc" },
  "win32-arm64": { arch: "aarch64", os: "pc-windows-msvc" },
  "win32-ia32": { arch: "i686", os: "pc-windows-msvc" },
}

export function getCacheDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA
    const base = localAppData || join(homedir(), "AppData", "Local")
    return join(base, "matrixx", "bin")
  }

  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "matrixx", "bin")
}

export function getBinaryName(): string {
  return process.platform === "win32" ? "sg.exe" : "sg"
}

export function getCachedBinaryPath(): string | null {
  return getCachedBinaryPathShared(getCacheDir(), getBinaryName())
}

async function downloadAstGrep(version: string = DEFAULT_VERSION): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]

  if (!platformInfo) {
    log(`[matrixx] Unsupported platform for ast-grep: ${platformKey}`)
    return null
  }

  const cacheDir = getCacheDir()
  const binaryName = getBinaryName()
  const binaryPath = join(cacheDir, binaryName)

  if (existsSync(binaryPath) && verifyCachedBinary(binaryPath)) {
    return binaryPath
  }

  const { arch, os } = platformInfo
  const assetName = `app-${arch}-${os}.zip`
  const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/${assetName}`
  const archivePath = join(cacheDir, assetName)

  log(`[matrixx] Downloading ast-grep binary...`)

  try {
    ensureCacheDir(cacheDir)
    await downloadArchive(downloadUrl, archivePath)
    await verifyArchiveChecksum(archivePath, version, assetName)
    await extractZipArchive(archivePath, cacheDir)
    cleanupArchive(archivePath)
    ensureExecutable(binaryPath)
    writeCachedChecksum(binaryPath)

    log(`[matrixx] ast-grep binary ready.`)

    return binaryPath
  } catch (err) {
    removeInstalledBinary(archivePath, binaryPath)
    log(
      `[matrixx] Failed to download ast-grep: ${err instanceof Error ? err.message : err}`
    )
    return null
  }
}

function removeInstalledBinary(archivePath: string, binaryPath: string): void {
  for (const filePath of [archivePath, binaryPath, getChecksumSidecarPath(binaryPath)]) {
    try {
      cleanupArchive(filePath)
    } catch {
      log(`[matrixx] Could not remove ${filePath} after a failed download`)
    }
  }
}

export async function ensureAstGrepBinary(): Promise<string | null> {
  const cachedPath = getCachedBinaryPath()
  if (cachedPath && verifyCachedBinary(cachedPath)) {
    return cachedPath
  }

  const version = getAstGrepVersion()
  return downloadAstGrep(version)
}
