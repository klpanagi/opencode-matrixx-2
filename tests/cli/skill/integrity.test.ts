import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  computeSha512Base64,
  IntegrityFormatError,
  IntegrityMismatchError,
  verifySha512,
} from "../../../src/cli/skill-pack/integrity"

const PAYLOAD = Buffer.from("matrixx skill-pack tarball fixture\n")

function sha512Base64(bytes: Buffer): string {
  return createHash("sha512").update(bytes).digest("base64")
}

function captureError(fn: () => void): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error("expected the function to throw")
}

describe("computeSha512Base64", () => {
  let dir: string
  let tarballPath: string

  beforeEach(() => {
    //#given a tarball fixture written to a temporary directory
    dir = mkdtempSync(join(tmpdir(), "matrixx-integrity-"))
    tarballPath = join(dir, "pack.tgz")
    writeFileSync(tarballPath, PAYLOAD)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns the base64-encoded SHA-512 digest of the file", () => {
    //#when
    const digest = computeSha512Base64(tarballPath)
    //#then
    expect(digest).toBe(sha512Base64(PAYLOAD))
  })
})

describe("verifySha512", () => {
  let dir: string
  let tarballPath: string

  beforeEach(() => {
    //#given a tarball fixture written to a temporary directory
    dir = mkdtempSync(join(tmpdir(), "matrixx-integrity-"))
    tarballPath = join(dir, "pack.tgz")
    writeFileSync(tarballPath, PAYLOAD)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("passes when the single sha512 digest matches", () => {
    //#given
    const integrity = `sha512-${sha512Base64(PAYLOAD)}`
    //#when / #then
    expect(() => verifySha512(tarballPath, integrity)).not.toThrow()
  })

  test("passes when the digest is surrounded by whitespace", () => {
    //#given
    const integrity = `  sha512-${sha512Base64(PAYLOAD)}  \n`
    //#when / #then
    expect(() => verifySha512(tarballPath, integrity)).not.toThrow()
  })

  test("fails when a single byte is mutated", () => {
    //#given a file whose first byte changed after the digest was recorded
    const integrity = `sha512-${sha512Base64(PAYLOAD)}`
    const mutated = Buffer.from(PAYLOAD)
    mutated[0] = mutated[0] ^ 0xff
    writeFileSync(tarballPath, mutated)
    //#when
    const error = captureError(() => verifySha512(tarballPath, integrity))
    //#then
    expect(error).toBeInstanceOf(IntegrityMismatchError)
    expect((error as IntegrityMismatchError).code).toBe("INTEGRITY_MISMATCH")
  })

  test("does not modify the tarball when verification fails", () => {
    //#given
    const integrity = `sha512-${sha512Base64(PAYLOAD)}`
    const mutated = Buffer.from(PAYLOAD)
    mutated[mutated.length - 1] = mutated[mutated.length - 1] ^ 0xff
    writeFileSync(tarballPath, mutated)
    //#when
    expect(() => verifySha512(tarballPath, integrity)).toThrow(IntegrityMismatchError)
    //#then the file is left exactly as it was
    expect(readFileSync(tarballPath)).toEqual(mutated)
  })

  test("passes when any sha512 digest in a space-separated list matches", () => {
    //#given one stale digest followed by the current one
    const stale = sha512Base64(Buffer.from("stale build"))
    const current = sha512Base64(PAYLOAD)
    const integrity = `sha512-${stale} sha512-${current}`
    //#when / #then
    expect(() => verifySha512(tarballPath, integrity)).not.toThrow()
  })

  test("ignores non-sha512 algorithms in the list", () => {
    //#given an sha256 entry alongside a matching sha512 entry
    const integrity = `sha256-${sha512Base64(PAYLOAD)} sha512-${sha512Base64(PAYLOAD)}`
    //#when / #then
    expect(() => verifySha512(tarballPath, integrity)).not.toThrow()
  })

  test("fails when every sha512 digest in the list is wrong", () => {
    //#given
    const stale = sha512Base64(Buffer.from("stale build"))
    const older = sha512Base64(Buffer.from("older build"))
    const integrity = `sha512-${stale} sha512-${older}`
    //#when / #then
    expect(() => verifySha512(tarballPath, integrity)).toThrow(IntegrityMismatchError)
  })

  test("reports byte lengths only, never the digests themselves", () => {
    //#given
    const expected = sha512Base64(Buffer.from("different content"))
    const actual = sha512Base64(PAYLOAD)
    const integrity = `sha512-${expected}`
    //#when
    const error = captureError(() => verifySha512(tarballPath, integrity)) as IntegrityMismatchError
    //#then the message names the lengths but leaks neither digest
    expect(error.message).toContain(String(Buffer.from(expected, "base64").length))
    expect(error.message).toContain(String(Buffer.from(actual, "base64").length))
    expect(error.message).not.toContain(expected)
    expect(error.message).not.toContain(actual)
  })

  test("treats a wrong-length digest as a mismatch without timingSafeEqual", () => {
    //#given a syntactically valid but short base64 payload
    const integrity = "sha512-AAAA"
    //#when
    const error = captureError(() => verifySha512(tarballPath, integrity))
    //#then
    expect(error).toBeInstanceOf(IntegrityMismatchError)
    expect((error as IntegrityMismatchError).expectedLength).toBe(3)
    expect((error as IntegrityMismatchError).actualLength).toBe(64)
  })

  test("throws an IntegrityFormatError when no sha512 entry exists", () => {
    //#given only a non-sha512 algorithm is provided
    const integrity = `sha256-${sha512Base64(PAYLOAD)}`
    //#when
    const error = captureError(() => verifySha512(tarballPath, integrity))
    //#then
    expect(error).toBeInstanceOf(IntegrityFormatError)
    expect((error as IntegrityFormatError).code).toBe("INTEGRITY_FORMAT")
  })

  test("throws an IntegrityFormatError for an empty integrity string", () => {
    //#given / #when
    const error = captureError(() => verifySha512(tarballPath, "   "))
    //#then
    expect(error).toBeInstanceOf(IntegrityFormatError)
  })

  test("throws an IntegrityFormatError for an empty sha512 payload", () => {
    //#given / #when
    const error = captureError(() => verifySha512(tarballPath, "sha512-"))
    //#then
    expect(error).toBeInstanceOf(IntegrityFormatError)
  })

  test("throws an IntegrityFormatError for a non-base64 sha512 payload", () => {
    //#given / #when
    const error = captureError(() => verifySha512(tarballPath, "sha512-!!not-base64!!"))
    //#then
    expect(error).toBeInstanceOf(IntegrityFormatError)
  })
})
