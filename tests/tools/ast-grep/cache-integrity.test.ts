/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getChecksumSidecarPath,
  verifyCachedBinary,
  writeCachedChecksum,
} from "../../../src/tools/ast-grep/cache-integrity"
import { computeSha256 } from "../../../src/tools/ast-grep/checksum"

const BINARY_CONTENT = "real-ast-grep-binary\n"
const LOG_FILE = join(tmpdir(), "matrixx.log")
const INTEGRITY_LOG = "cached sg binary failed integrity check; re-downloading"
const canSimulateEacces = typeof process.getuid === "function" && process.getuid() !== 0

let tempDir: string
let binaryPath: string

function readLog(): string {
  try {
    return readFileSync(LOG_FILE, "utf8")
  } catch {
    return ""
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "matrixx-cache-integrity-"))
  binaryPath = join(tempDir, "sg")
  writeFileSync(binaryPath, BINARY_CONTENT)
})

afterEach(() => {
  chmodSync(tempDir, 0o755)
  rmSync(tempDir, { recursive: true, force: true })
})

describe("verifyCachedBinary", () => {
  it("#when a cached binary has a matching sidecar #then accepts it without downloading", () => {
    //#given
    writeFileSync(getChecksumSidecarPath(binaryPath), `${computeSha256(binaryPath)}\n`)

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(true)
    expect(existsSync(binaryPath)).toBe(true)
  })

  it("#when a cached binary has no sidecar #then deletes it and logs the re-download", () => {
    //#given
    const before = readLog()

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(false)
    expect(existsSync(binaryPath)).toBe(false)
    expect(readLog().slice(before.length)).toContain(INTEGRITY_LOG)
  })

  it("#when the sidecar digest does not match the binary #then deletes both and logs the re-download", () => {
    //#given
    const sidecarPath = getChecksumSidecarPath(binaryPath)
    writeFileSync(sidecarPath, `${"0".repeat(64)}\n`)
    const before = readLog()

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(false)
    expect(existsSync(binaryPath)).toBe(false)
    expect(existsSync(sidecarPath)).toBe(false)
    expect(readLog().slice(before.length)).toContain(INTEGRITY_LOG)
  })

  it("#when the sidecar is empty #then treats the binary as corrupt", () => {
    //#given
    writeFileSync(getChecksumSidecarPath(binaryPath), "")

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(false)
    expect(existsSync(binaryPath)).toBe(false)
  })

  it("#when the cache is read-only and the binary cannot be deleted #then returns false without throwing", () => {
    //#given
    chmodSync(tempDir, 0o555)
    const before = readLog()

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(false)
    expect(existsSync(binaryPath)).toBe(true)
    expect(readLog().slice(before.length)).toContain(INTEGRITY_LOG)
  })

  it.skipIf(!canSimulateEacces)("#when the sidecar cannot be read #then treats the cache as unverified", () => {
    //#given
    const sidecarPath = getChecksumSidecarPath(binaryPath)
    writeFileSync(sidecarPath, `${computeSha256(binaryPath)}\n`)
    chmodSync(sidecarPath, 0o000)
    const before = readLog()

    //#when
    const valid = verifyCachedBinary(binaryPath)

    //#then
    expect(valid).toBe(false)
    expect(existsSync(binaryPath)).toBe(true)
    expect(readLog().slice(before.length)).toContain("Could not read checksum sidecar")
  })
})

describe("writeCachedChecksum", () => {
  it("#when the binary is installed #then writes its sha256 to the sidecar", () => {
    //#given
    const sidecarPath = getChecksumSidecarPath(binaryPath)

    //#when
    writeCachedChecksum(binaryPath)

    //#then
    expect(readFileSync(sidecarPath, "utf8").trim()).toBe(computeSha256(binaryPath))
  })

  it.skipIf(!canSimulateEacces)("#when the sidecar cannot be written #then keeps the binary and warns without throwing", () => {
    //#given
    chmodSync(tempDir, 0o555)
    const before = readLog()

    //#when
    const write = () => writeCachedChecksum(binaryPath)

    //#then
    expect(write).not.toThrow()
    expect(existsSync(binaryPath)).toBe(true)
    expect(readLog().slice(before.length)).toContain("Could not write checksum sidecar")
  })
})
