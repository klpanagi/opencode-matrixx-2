/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  PINNED_ASSET_SHA256,
  compareSha256Hex,
  computeSha256,
  resolveExpectedSha256,
  verifyArchiveChecksum,
} from "../../../src/tools/ast-grep/checksum"
import { DEFAULT_VERSION, PLATFORM_MAP } from "../../../src/tools/ast-grep/downloader"

const FIXTURE_CONTENT = "ast-grep-fixture\n"
const FIXTURE_SHA256 = "16ce851ef26c9b1fe26493e744b1937cd20904939588b52006a5d76bdd31ab5b"
const LINUX_X64_ASSET = "app-x86_64-unknown-linux-gnu.zip"
const PINNED_VERSION = "0.40.5"
const UNPINNED_VERSION = "0.41.0"
const LOG_FILE = join(tmpdir(), "matrixx.log")
const originalFetch = globalThis.fetch

let tempDir: string
let archivePath: string

function readLog(): string {
  try {
    return readFileSync(LOG_FILE, "utf8")
  } catch {
    return ""
  }
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = handler as unknown as typeof globalThis.fetch
}

function releaseResponse(digest: unknown): Response {
  return new Response(JSON.stringify({ assets: [{ name: LINUX_X64_ASSET, digest }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function readInstalledVersion(): string | null {
  try {
    const requireFromTest = createRequire(import.meta.url)
    const pkg = requireFromTest("@ast-grep/cli/package.json")
    return typeof pkg.version === "string" ? pkg.version : null
  } catch {
    return null
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "matrixx-checksum-"))
  archivePath = join(tempDir, LINUX_X64_ASSET)
  writeFileSync(archivePath, FIXTURE_CONTENT)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
})

describe("computeSha256", () => {
  it("#when hashing a fixture file #then returns its hex sha256", () => {
    //#given
    //#when
    const digest = computeSha256(archivePath)

    //#then
    expect(digest).toBe(FIXTURE_SHA256)
  })
})

describe("compareSha256Hex", () => {
  it("#when both hex strings are equal #then returns true", () => {
    //#given
    //#when
    const matches = compareSha256Hex(FIXTURE_SHA256, FIXTURE_SHA256)

    //#then
    expect(matches).toBe(true)
  })

  it("#when hex strings differ in length #then returns false without throwing", () => {
    //#given
    //#when
    const matches = compareSha256Hex("abc", "abcdef")

    //#then
    expect(matches).toBe(false)
  })

  it("#when equal-length hex strings differ #then returns false", () => {
    //#given
    const other = `${FIXTURE_SHA256.slice(0, -1)}0`

    //#when
    const matches = compareSha256Hex(FIXTURE_SHA256, other)

    //#then
    expect(matches).toBe(false)
  })
})

describe("resolveExpectedSha256", () => {
  it("#when the version and asset are pinned #then returns the pinned digest without fetching", async () => {
    //#given
    stubFetch(async () => {
      throw new Error("network must not be used for a pinned asset")
    })

    //#when
    const digest = await resolveExpectedSha256(PINNED_VERSION, LINUX_X64_ASSET)

    //#then
    expect(digest).toBe(PINNED_ASSET_SHA256[`${PINNED_VERSION}/${LINUX_X64_ASSET}`])
  })

  it("#when the version is unpinned #then fetches the release and returns the asset digest", async () => {
    //#given
    const digest = FIXTURE_SHA256
    let requestedUrl = ""
    let acceptHeader: string | null = null
    stubFetch(async (input, init) => {
      requestedUrl = String(input)
      acceptHeader = new Headers(init?.headers).get("accept")
      return releaseResponse(`sha256:${digest.toUpperCase()}`)
    })

    //#when
    const resolved = await resolveExpectedSha256(UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    expect(resolved).toBe(digest)
    expect(requestedUrl).toBe(
      `https://api.github.com/repos/ast-grep/ast-grep/releases/tags/${UNPINNED_VERSION}`
    )
    expect(acceptHeader).toBe("application/vnd.github+json")
  })

  it("#when the release API responds 404 #then returns null", async () => {
    //#given
    stubFetch(async () => new Response("not found", { status: 404 }))

    //#when
    const resolved = await resolveExpectedSha256(UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    expect(resolved).toBeNull()
  })

  it("#when the network request throws #then returns null", async () => {
    //#given
    stubFetch(async () => {
      throw new Error("offline")
    })

    //#when
    const resolved = await resolveExpectedSha256(UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    expect(resolved).toBeNull()
  })

  it("#when the response body is not JSON #then returns null", async () => {
    //#given
    stubFetch(async () => new Response("not json", { status: 200 }))

    //#when
    const resolved = await resolveExpectedSha256(UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    expect(resolved).toBeNull()
  })

  const malformedDigests: Array<[string, unknown]> = [
    ["a short payload", "sha256:abc"],
    ["an empty payload", "sha256:"],
    ["a non-sha256 algorithm", "md5:16ce851ef26c9b1fe26493e744b1937cd20904939588b52006a5d76bdd31ab5b"],
    ["a non-string digest", 42],
    ["a missing digest", undefined],
    ["a 63-character payload", `sha256:${FIXTURE_SHA256.slice(1)}`],
    ["a non-hex payload", `sha256:${"z".repeat(64)}`],
  ]

  for (const [label, digest] of malformedDigests) {
    it(`#when the API digest is ${label} #then treats it as unavailable`, async () => {
      //#given
      stubFetch(async () => releaseResponse(digest))

      //#when
      const resolved = await resolveExpectedSha256(UNPINNED_VERSION, LINUX_X64_ASSET)

      //#then
      expect(resolved).toBeNull()
    })
  }
})

describe("verifyArchiveChecksum", () => {
  it("#when the archive digest matches a pinned entry #then resolves", async () => {
    //#given
    const key = `9.9.9/${LINUX_X64_ASSET}`
    const pinnedMap = PINNED_ASSET_SHA256 as Record<string, string>
    pinnedMap[key] = computeSha256(archivePath)

    try {
      //#when
      const verification = verifyArchiveChecksum(archivePath, "9.9.9", LINUX_X64_ASSET)

      //#then
      await expect(verification).resolves.toBeUndefined()
      expect(existsSync(archivePath)).toBe(true)
    } finally {
      delete pinnedMap[key]
    }
  })

  it("#when the archive digest does not match the pinned entry #then throws, names both digests, and deletes the archive", async () => {
    //#given
    const expected = PINNED_ASSET_SHA256[`${PINNED_VERSION}/${LINUX_X64_ASSET}`]
    const actual = computeSha256(archivePath)

    //#when
    const verification = verifyArchiveChecksum(archivePath, PINNED_VERSION, LINUX_X64_ASSET)

    //#then
    await expect(verification).rejects.toThrow(
      `ast-grep archive checksum mismatch for ${LINUX_X64_ASSET}: expected ${expected}, got ${actual}`
    )
    expect(existsSync(archivePath)).toBe(false)
  })

  it("#when the API supplies a matching digest #then resolves", async () => {
    //#given
    stubFetch(async () => releaseResponse(`sha256:${computeSha256(archivePath)}`))

    //#when
    const verification = verifyArchiveChecksum(archivePath, UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    await expect(verification).resolves.toBeUndefined()
    expect(existsSync(archivePath)).toBe(true)
  })

  it("#when no checksum is available #then warns and proceeds unverified", async () => {
    //#given
    stubFetch(async () => new Response("not found", { status: 404 }))
    const before = readLog()

    //#when
    const verification = verifyArchiveChecksum(archivePath, UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    await expect(verification).resolves.toBeUndefined()
    expect(existsSync(archivePath)).toBe(true)
    expect(readLog().slice(before.length)).toContain(
      `No checksum available for ${LINUX_X64_ASSET}; proceeding unverified`
    )
  })

  it("#when the API returns a malformed digest #then proceeds without a false pass or throw", async () => {
    //#given
    stubFetch(async () => releaseResponse("sha256:not-a-real-digest"))

    //#when
    const verification = verifyArchiveChecksum(archivePath, UNPINNED_VERSION, LINUX_X64_ASSET)

    //#then
    await expect(verification).resolves.toBeUndefined()
    expect(existsSync(archivePath)).toBe(true)
  })
})

describe("pinned checksum coverage", () => {
  const installedVersion = readInstalledVersion()
  const coverageTest = installedVersion === null ? it.skip : it

  coverageTest("#given the installed @ast-grep/cli version #when the pinned map is inspected #then every platform asset has a digest", () => {
    //#given
    if (installedVersion === null) return
    const missing: string[] = []

    //#when
    for (const { arch, os } of Object.values(PLATFORM_MAP)) {
      const key = `${installedVersion}/app-${arch}-${os}.zip`
      if (typeof PINNED_ASSET_SHA256[key] !== "string") missing.push(key)
    }

    //#then
    expect(missing).toEqual([])
    expect(installedVersion).not.toBe("")
  })

  coverageTest("#given the installed @ast-grep/cli version #when DEFAULT_VERSION is read #then it tracks the installed package", () => {
    //#given
    //#when
    //#then
    expect(DEFAULT_VERSION).toBe(installedVersion)
  })
})
