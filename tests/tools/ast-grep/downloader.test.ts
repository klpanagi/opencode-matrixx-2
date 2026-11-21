/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getChecksumSidecarPath } from "../../../src/tools/ast-grep/cache-integrity"
import { computeSha256 } from "../../../src/tools/ast-grep/checksum"
import { PLATFORM_MAP, ensureAstGrepBinary } from "../../../src/tools/ast-grep/downloader"

const LOG_FILE = join(tmpdir(), "matrixx.log")
const originalFetch = globalThis.fetch
const CACHE_ENV_KEYS = ["XDG_CACHE_HOME", "LOCALAPPDATA", "APPDATA"] as const

let tempHome: string
let cacheDir: string
let binaryPath: string
let assetPath: string
const originalEnv: Record<string, string | undefined> = {}

function readLog(): string {
  try {
    return readFileSync(LOG_FILE, "utf8")
  } catch {
    return ""
  }
}

function stubDownload(bytes: string): { calls: string[] } {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes("api.github.com")) {
      throw new Error("a pinned version must not call the release API")
    }
    return new Response(bytes, { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { calls }
}

const platformInfo = PLATFORM_MAP[`${process.platform}-${process.arch}`]
const assetName = platformInfo ? `app-${platformInfo.arch}-${platformInfo.os}.zip` : ""

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "matrixx-downloader-"))
  cacheDir = join(tempHome, "matrixx", "bin")
  const binaryName = process.platform === "win32" ? "sg.exe" : "sg"
  binaryPath = join(cacheDir, binaryName)
  assetPath = join(cacheDir, assetName)

  for (const key of CACHE_ENV_KEYS) {
    originalEnv[key] = process.env[key]
    process.env[key] = tempHome
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of CACHE_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe("ensureAstGrepBinary", () => {
  it("#when the cached binary and sidecar match #then returns it without downloading", async () => {
    //#given
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(binaryPath, "cached-ast-grep-binary")
    writeFileSync(getChecksumSidecarPath(binaryPath), computeSha256(binaryPath))
    const fetchStub = stubDownload("unexpected")

    //#when
    const resolved = await ensureAstGrepBinary()

    //#then
    expect(resolved).toBe(binaryPath)
    expect(fetchStub.calls).toEqual([])
  })

  it("#when the cached binary has no sidecar #then deletes it and attempts a fresh download", async () => {
    //#given
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(binaryPath, "corrupt-cached-binary")
    const fetchStub = stubDownload("downloaded-archive-bytes")
    const before = readLog()

    //#when
    const resolved = await ensureAstGrepBinary()

    //#then
    const logDelta = readLog().slice(before.length)
    expect(fetchStub.calls).toHaveLength(1)
    expect(fetchStub.calls[0]).toContain(`releases/download/`)
    expect(logDelta).toContain("cached sg binary failed integrity check; re-downloading")
    expect(logDelta).toContain("Downloading ast-grep binary")
    expect(logDelta).toContain("checksum mismatch")
    expect(resolved).toBeNull()
    expect(existsSync(binaryPath)).toBe(false)
    expect(existsSync(assetPath)).toBe(false)
  })
})
