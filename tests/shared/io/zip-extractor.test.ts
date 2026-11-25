/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  MAX_ZIP_MEMBERS,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  UnsafeZipEntryError,
  type ZipEntryInfo,
  assertArchiveSizeCaps,
  extractZip,
  parseTarLongListing,
  parseUnzipLongListing,
  parseZipNameListing,
  validateZipEntries,
  verifyExtractedTotalSize,
} from "../../../src/shared/io/zip-extractor"

const FIXTURE_DIR = join(import.meta.dir, "../../fixtures/security")
const BENIGN_ZIP = join(FIXTURE_DIR, "benign.zip")
const ZIP_SLIP_ZIP = join(FIXTURE_DIR, "zip-slip.zip")
const REGULAR_MODE = "-rw-r--r--"
const SYMLINK_MODE = "lrwxrwxrwx"

let tempDir: string
let destDir: string

function entry(name: string, mode: string | null = REGULAR_MODE): ZipEntryInfo {
  return { name, mode }
}

function expectUnsafe(fn: () => void): void {
  expect(fn).toThrow(UnsafeZipEntryError)
}

function listFixtureMembers(archivePath: string): string[] {
  const result = Bun.spawnSync(["unzip", "-Z1", "--", archivePath], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(`cannot list fixture ${archivePath}`)
  return result.stdout.toString().split(/\r?\n/).filter((line) => line.length > 0)
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "matrixx-zip-"))
  destDir = join(tempDir, "dest")
  mkdirSync(destDir)
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("extractZip", () => {
  it("#when the archive is benign #then every member is extracted inside the destination", async () => {
    //#given
    const members = listFixtureMembers(BENIGN_ZIP)

    //#when
    await extractZip(BENIGN_ZIP, destDir)

    //#then
    expect(members).toHaveLength(2)
    for (const member of members) {
      expect(existsSync(join(destDir, member))).toBe(true)
    }
    expect(readFileSync(join(destDir, "a.txt"), "utf8")).toBe("alpha\n")
    expect(readFileSync(join(destDir, "b.txt"), "utf8")).toBe("beta\n")
  })

  it("#when the archive contains a zipslip '..' member #then it is rejected before extracting anything", async () => {
    //#given
    const escapedTarget = resolve(destDir, "../../evil.txt")

    //#when
    const extraction = extractZip(ZIP_SLIP_ZIP, destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    expect(readdirSync(destDir)).toEqual([])
    expect(existsSync(escapedTarget)).toBe(false)
    expect(existsSync(join(tempDir, "evil.txt"))).toBe(false)
  })

  it("#when the archive cannot be listed #then it fails closed and leaves the destination empty", async () => {
    //#given
    const missingArchive = join(tempDir, "missing.zip")

    //#when
    const extraction = extractZip(missingArchive, destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    expect(readdirSync(destDir)).toEqual([])
  })

  it("#when the archive contains a symlink member #then it is rejected before extracting anything", async () => {
    //#given
    //#when
    const extraction = extractZip(join(FIXTURE_DIR, "zip-symlink.zip"), destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    expect(readdirSync(destDir)).toEqual([])
  })

  it("#when the archive contains a backslash traversal member #then it is rejected before extracting anything", async () => {
    //#given
    const escapedTarget = resolve(tempDir, "evil.txt")

    //#when
    const extraction = extractZip(join(FIXTURE_DIR, "zip-backslash.zip"), destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    expect(readdirSync(destDir)).toEqual([])
    expect(existsSync(escapedTarget)).toBe(false)
  })

  it("#when the archive has no members #then it fails closed and leaves the destination empty", async () => {
    //#given
    //#when
    const extraction = extractZip(join(FIXTURE_DIR, "empty.zip"), destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    expect(readdirSync(destDir)).toEqual([])
  })
})

describe("validateZipEntries", () => {
  it("#when every member is a regular file inside the destination #then it accepts", () => {
    //#given
    const entries = [entry("a.txt"), entry("nested/b.txt")]

    //#when
    //#then
    expect(() => validateZipEntries(entries, destDir)).not.toThrow()
  })

  it("#when the archive has no members #then it rejects", () => {
    //#given
    //#when
    //#then
    expectUnsafe(() => validateZipEntries([], destDir))
  })

  it("#when a member is an absolute POSIX path #then it rejects", () => {
    //#given
    const entries = [entry("/etc/passwd")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member is a Windows drive path #then it rejects", () => {
    //#given
    const entries = [entry("C:\\Windows\\evil.txt")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member uses backslash traversal #then it rejects", () => {
    //#given
    const entries = [entry("..\\..\\evil.txt")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member has a '..' segment that normalizes back inside #then it still rejects", () => {
    //#given
    const entries = [entry("nested/../a.txt")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member normalizes outside after path resolution #then it rejects", () => {
    //#given a name with no literal '..' segment that still escapes via an empty segment trick
    const entries = [entry("a/../../evil.txt")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member name contains a NUL byte #then it rejects", () => {
    //#given
    const entries = [entry("a\u0000.txt")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member is a symlink #then it rejects", () => {
    //#given
    const entries = [entry("link", SYMLINK_MODE)]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member mode cannot be determined #then it rejects", () => {
    //#given
    const entries = [entry("a.txt", null)]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })

  it("#when a member name is empty #then it rejects", () => {
    //#given
    const entries = [entry("")]

    //#when
    //#then
    expectUnsafe(() => validateZipEntries(entries, destDir))
  })
})

describe("parseZipNameListing", () => {
  it("#when given -Z1 output #then returns one name per non-empty line", () => {
    //#given
    const output = "a.txt\nnested/b.txt\n"

    //#when
    const names = parseZipNameListing(output)

    //#then
    expect(names).toEqual(["a.txt", "nested/b.txt"])
  })
})

describe("parseUnzipLongListing", () => {
  it("#when given zipinfo output #then returns names with their modes", () => {
    //#given
    const output = [
      "Archive:  benign.zip",
      "Zip file size: 309 bytes, number of entries: 2",
      "-rw-r--r--  3.0 unx        6 tx stor 26-Nov-25 14:38 a.txt",
      "drwxr-xr-x  3.0 unx        0 bx stor 26-Nov-25 14:38 nested/",
      "2 files, 11 bytes uncompressed",
    ].join("\n")

    //#when
    const entries = parseUnzipLongListing(output)

    //#then
    expect(entries).toEqual([
      { name: "a.txt", mode: REGULAR_MODE, uncompressedSize: 6 },
      { name: "nested/", mode: "drwxr-xr-x", uncompressedSize: 0 },
    ])
  }),

  it("#when given zipinfo output #then captures the declared uncompressed size", () => {
    //#given
    const output = "-rw-r--r--  3.0 unx     1234 tx defX 26-Nov-25 14:38 big.bin"

    //#when
    const entries = parseUnzipLongListing(output)

    //#then
    expect(entries[0]?.uncompressedSize).toBe(1234)
  })

  it("#when given a symlink row #then reports an 'l' mode so validation can reject it", () => {
    //#given
    const output = "lrwxrwxrwx  3.0 unx        9 tx stor 26-Nov-25 14:38 link -> ../../evil.txt"

    //#when
    const entries = parseUnzipLongListing(output)

    //#then
    expect(entries).toHaveLength(1)
    expect(entries[0]?.mode).toBe(SYMLINK_MODE)
  })

  it("#when a row carries an unknown permission set #then reports a null mode", () => {
    //#given
    const output = "?rw-r--r--  3.0 unx        6 tx stor 26-Nov-25 14:38 a.txt"

    //#when
    const entries = parseUnzipLongListing(output)

    //#then
    expect(entries[0]?.mode).toBeNull()
  })
})

describe("parseTarLongListing", () => {
  it("#when given bsdtar output #then returns names with their modes", () => {
    //#given
    const output = [
      "-rw-r--r--  0 0      6 Nov 25 14:38 a.txt",
      "drwxr-xr-x  0 0      0 Nov 25 14:38 nested/",
    ].join("\n")

    //#when
    const entries = parseTarLongListing(output)

    //#then
    expect(entries).toEqual([entry("a.txt"), entry("nested/", "drwxr-xr-x")])
  })
})

describe("extractZip: resource caps", () => {
  function buildZipFixture(archivePath: string, sourceDir: string): void {
    const zip = Bun.spawnSync(["zip", "-q", "-r", archivePath, "."], {
      cwd: sourceDir,
      stdout: "ignore",
      stderr: "pipe",
    })
    if (zip.exitCode !== 0) throw new Error(`cannot build fixture ${archivePath}`)
  }

  it("#when the archive declares more members than the cap #then it is rejected before extracting anything", async () => {
    //#given an archive with MAX_ZIP_MEMBERS + 1 members built at test time
    const sourceDir = join(tempDir, "many")
    mkdirSync(sourceDir)
    for (let i = 0; i < MAX_ZIP_MEMBERS + 1; i++) {
      writeFileSync(join(sourceDir, `f${i}.txt`), "")
    }
    const archive = join(tempDir, "too-many-members.zip")
    buildZipFixture(archive, sourceDir)

    //#when
    const extraction = extractZip(archive, destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    await expect(extraction).rejects.toThrow(/members, exceeding the maximum/)
    expect(readdirSync(destDir)).toEqual([])
  })

  it("#when the archive declares more uncompressed bytes than the cap #then it is rejected before extracting anything", async () => {
    //#given an archive whose declared uncompressed size exceeds the 512 MiB cap (sparse file, so the fixture stays small)
    const sourceDir = join(tempDir, "big")
    mkdirSync(sourceDir)
    const bigFile = join(sourceDir, "big.bin")
    writeFileSync(bigFile, "")
    truncateSync(bigFile, MAX_ZIP_UNCOMPRESSED_BYTES + 1)
    const archive = join(tempDir, "too-big.zip")
    buildZipFixture(archive, sourceDir)

    //#when
    const extraction = extractZip(archive, destDir)

    //#then
    await expect(extraction).rejects.toBeInstanceOf(UnsafeZipEntryError)
    await expect(extraction).rejects.toThrow(/uncompressed bytes across members, exceeding the maximum/)
    expect(readdirSync(destDir)).toEqual([])
  })
})

describe("assertArchiveSizeCaps", () => {
  it("#when any member lacks a declared uncompressed size #then it rejects instead of skipping the byte cap", () => {
    //#given a primary-path listing where one member's size could not be established
    const entries = [
      { name: "a.txt", mode: REGULAR_MODE, uncompressedSize: 100 },
      { name: "b.bin", mode: REGULAR_MODE, uncompressedSize: null },
    ]

    //#when
    //#then it fails closed: the byte cap cannot be verified, so extraction is refused
    expectUnsafe(() => assertArchiveSizeCaps(entries, "archive.zip"))
  })

  it("#when only a tar-fallback listing without sizes is available #then it rejects", () => {
    //#given the tar listing parser never provides per-member sizes
    const tarListing = [
      "-rw-r--r--  0 0      6 Nov 25 14:38 a.txt",
      "drwxr-xr-x  0 0      0 Nov 25 14:38 nested/",
    ].join("\n")
    const entries = parseTarLongListing(tarListing)

    //#when
    //#then
    expect(entries.every((entry) => entry.uncompressedSize === undefined)).toBe(true)
    expectUnsafe(() => assertArchiveSizeCaps(entries, "archive.zip"))
  })

  it("#when every member declares a size under the cap #then it accepts", () => {
    //#given
    const entries = [
      { name: "a.txt", mode: REGULAR_MODE, uncompressedSize: 6 },
      { name: "nested/", mode: "drwxr-xr-x", uncompressedSize: 0 },
    ]

    //#when
    //#then
    expect(() => assertArchiveSizeCaps(entries, "archive.zip")).not.toThrow()
  })

  it("#when the declared total exceeds the byte cap #then it rejects", () => {
    //#given
    const entries = [
      { name: "big.bin", mode: REGULAR_MODE, uncompressedSize: MAX_ZIP_UNCOMPRESSED_BYTES + 1 },
    ]

    //#when
    //#then
    expectUnsafe(() => assertArchiveSizeCaps(entries, "archive.zip"))
  })
})

describe("verifyExtractedTotalSize", () => {
  it("#when the extracted tree exceeds the byte cap #then it throws and empties the destination", () => {
    //#given an extracted tree whose on-disk payload exceeds the cap
    mkdirSync(join(destDir, "nested"), { recursive: true })
    writeFileSync(join(destDir, "a.txt"), "x".repeat(64))
    writeFileSync(join(destDir, "nested", "b.bin"), "y".repeat(64))
    const cap = 10

    //#when
    //#then the breach throws and the oversized payload is removed from destDir
    expectUnsafe(() => verifyExtractedTotalSize(destDir, cap))
    expect(readdirSync(destDir)).toEqual([])
  })

  it("#when the extracted tree is within the byte cap #then it keeps the extraction intact", () => {
    //#given
    mkdirSync(join(destDir, "nested"), { recursive: true })
    writeFileSync(join(destDir, "a.txt"), "x".repeat(64))
    writeFileSync(join(destDir, "nested", "b.bin"), "y".repeat(32))

    //#when
    //#then
    expect(() => verifyExtractedTotalSize(destDir, MAX_ZIP_UNCOMPRESSED_BYTES)).not.toThrow()
    expect(readFileSync(join(destDir, "a.txt"), "utf8")).toBe("x".repeat(64))
  })

  it("#when the tree contains a symlink #then the walk does not follow it and the target size is not counted", () => {
    //#given a symlink in the tree pointing at a large file outside the destination
    const outsideFile = join(tempDir, "outside-big.bin")
    writeFileSync(outsideFile, "z".repeat(1024))
    writeFileSync(join(destDir, "a.txt"), "x".repeat(8))
    symlinkSync(outsideFile, join(destDir, "link.bin"))

    //#when the cap sits between the real payload and the linked target size
    //#then the walk counts only the link itself (no following), so it passes
    expect(() => verifyExtractedTotalSize(destDir, 64)).not.toThrow()
  })
})


