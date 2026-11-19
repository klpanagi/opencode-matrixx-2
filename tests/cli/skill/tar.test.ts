import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { gzipSync } from "node:zlib"
import {
  extractTarball,
  parseTar,
  type TarEntry,
  UnsafeTarEntryError,
} from "../../../src/cli/skill-pack/tar"

const BLOCK = 512
const ZERO_BLOCK = Buffer.alloc(BLOCK)

type FixtureEntry = {
  name: string
  body?: string
  type?: string
  prefix?: string
  /** Header size override; symlinks/link entries carry a linkname body but size 0. */
  declaredSize?: number
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0").slice(0, length - 1)
  buffer.write(encoded, offset, "ascii")
  buffer[offset + length - 1] = 0
}

function ustarHeader(name: string, size: number, typeflag: string, prefix = ""): Buffer {
  const header = Buffer.alloc(BLOCK)
  header.write(name.slice(0, 100), 0, 100, "utf8")
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header[156] = typeflag.charCodeAt(0)
  header.write("ustar", 257, "ascii")
  header[262] = 0
  header.write("00", 263, "ascii")
  if (prefix) header.write(prefix.slice(0, 155), 345, 155, "utf8")
  header.fill(0x20, 148, 156)
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii")
  header[154] = 0
  header[155] = 0x20
  return header
}

function tarEntry(entry: FixtureEntry): Buffer {
  const body = Buffer.from(entry.body ?? "", "utf8")
  const size = entry.declaredSize ?? body.length
  const header = ustarHeader(entry.name, size, entry.type ?? "0", entry.prefix ?? "")
  const padding = Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK)
  return Buffer.concat([header, body.subarray(0, size), padding])
}

function buildTgz(entries: FixtureEntry[]): Buffer {
  return gzipSync(Buffer.concat([...entries.map(tarEntry), ZERO_BLOCK, ZERO_BLOCK]))
}

function paxRecord(key: string, value: string): string {
  const payload = ` ${key}=${value}\n`
  let length = payload.length + 1
  while (String(length).length + payload.length !== length) {
    length = String(length).length + payload.length
  }
  return `${length}${payload}`
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "matrixx-tar-"))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeTgz(dir: string, entries: FixtureEntry[]): { archive: string; dest: string } {
  const archive = path.join(dir, "pack.tgz")
  writeFileSync(archive, buildTgz(entries))
  return { archive, dest: path.join(dir, "out") }
}

describe("parseTar", () => {
  test("parses entries, sizes and typeflags and stops at the zero blocks", () => {
    //#given a tarball with a directory and a file
    const buffer = Buffer.concat([
      tarEntry({ name: "package/assets/", type: "5" }),
      tarEntry({ name: "package/assets/data/a.json", body: '{"a":1}' }),
      ZERO_BLOCK,
      ZERO_BLOCK,
      tarEntry({ name: "ignored-after-end.txt", body: "x" }),
    ])

    //#when
    const entries = parseTar(buffer)

    //#then
    expect(entries.map((entry) => entry.name)).toEqual(["package/assets/", "package/assets/data/a.json"])
    expect(entries.map((entry) => entry.typeflag)).toEqual(["5", "0"])
    expect(entries[1]?.size).toBe(7)
  })

  test("joins the ustar prefix with the name", () => {
    //#given
    const buffer = Buffer.concat([
      tarEntry({ name: "data/a.json", prefix: "package/assets", body: "{}" }),
      ZERO_BLOCK,
      ZERO_BLOCK,
    ])

    //#when
    const entries = parseTar(buffer)

    //#then
    expect(entries[0]?.name).toBe("package/assets/data/a.json")
  })

  test("resolves a GNU long-name entry", () => {
    //#given
    const longName = "package/assets/skills/very-long-skill-name/SKILL.md"
    const buffer = Buffer.concat([
      tarEntry({ name: "././@LongLink", body: `${longName}\0`, type: "L" }),
      tarEntry({ name: "truncated", body: "# Skill" }),
      ZERO_BLOCK,
      ZERO_BLOCK,
    ])

    //#when
    const entries = parseTar(buffer)

    //#then
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe(longName)
    expect(entries[0]?.typeflag).toBe("0")
  })

  test("resolves a PAX path override", () => {
    //#given
    const paxPath = "package/assets/data/pax.json"
    const buffer = Buffer.concat([
      tarEntry({ name: "PaxHeaders/a", body: paxRecord("path", paxPath), type: "x" }),
      tarEntry({ name: "short.json", body: "{}" }),
      ZERO_BLOCK,
      ZERO_BLOCK,
    ])

    //#when
    const entries = parseTar(buffer)

    //#then
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe(paxPath)
  })

  test("treats a NUL typeflag as a regular file", () => {
    //#given
    const buffer = Buffer.concat([tarEntry({ name: "package/assets/a.txt", body: "a", type: "\0" }), ZERO_BLOCK, ZERO_BLOCK])

    //#when
    const entries: TarEntry[] = parseTar(buffer)

    //#then
    expect(entries[0]?.typeflag).toBe("0")
  })
})

describe("extractTarball", () => {
  test("extracts nested package/assets entries and ignores everything else", () => {
    //#given
    const entries: FixtureEntry[] = [
      { name: "package/", type: "5" },
      { name: "package/assets/", type: "5" },
      { name: "package/assets/data/", type: "5" },
      { name: "package/assets/data/a.json", body: '{"a":1}' },
      { name: "package/assets/skills/demo/SKILL.md", body: "# Demo" },
      { name: "package/dist/index.js", body: "console.log(1)" },
      { name: "package.json", body: '{"name":"pack"}' },
      { name: "README.md", body: "# Readme" },
    ]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when
      const result = extractTarball(archive, dest)

      //#then
      expect(result.files).toEqual(["assets/data/a.json", "assets/skills/demo/SKILL.md"])
      expect(readFileSync(path.join(dest, "assets/data/a.json"), "utf8")).toBe('{"a":1}')
      expect(readFileSync(path.join(dest, "assets/skills/demo/SKILL.md"), "utf8")).toBe("# Demo")
      expect(existsSync(path.join(dest, "assets/data"))).toBe(true)
      expect(existsSync(path.join(dest, "dist"))).toBe(false)
      expect(existsSync(path.join(dest, "package.json"))).toBe(false)
      expect(existsSync(path.join(dest, "README.md"))).toBe(false)
    })
  })

  test("rejects a relative traversal entry and writes nothing", () => {
    //#given
    const entries: FixtureEntry[] = [
      { name: "package/assets/data/ok.json", body: "{}" },
      { name: "package/assets/../../etc/passwd", body: "root:x:0:0" },
    ]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when
      let caught: unknown
      try {
        extractTarball(archive, dest)
      } catch (error) {
        caught = error
      }

      //#then
      expect(caught).toBeInstanceOf(UnsafeTarEntryError)
      expect((caught as UnsafeTarEntryError).code).toBe("UNSAFE_TAR_ENTRY")
      expect((caught as UnsafeTarEntryError).name).toBe("UnsafeTarEntryError")
      expect(existsSync(dest)).toBe(false)
      expect(existsSync(path.join(dir, "etc/passwd"))).toBe(false)
    })
  })

  test("rejects an absolute entry path", () => {
    //#given
    const entries: FixtureEntry[] = [{ name: "/etc/passwd", body: "root:x:0:0" }]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when / #then
      expect(() => extractTarball(archive, dest)).toThrow(UnsafeTarEntryError)
      expect(existsSync(dest)).toBe(false)
    })
  })

  test("rejects an unsafe entry even when it falls outside package/assets", () => {
    //#given
    const entries: FixtureEntry[] = [{ name: "package/../../escape.txt", body: "escaped" }]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when / #then
      expect(() => extractTarball(archive, dest)).toThrow(UnsafeTarEntryError)
      expect(existsSync(path.join(dir, "escape.txt"))).toBe(false)
    })
  })

  test("ignores symlink and hardlink entries", () => {
    //#given
    const entries: FixtureEntry[] = [
      { name: "package/assets/link", body: "../../etc/passwd", type: "2", declaredSize: 0 },
      { name: "package/assets/hard", body: "package/assets/data/a.json", type: "1", declaredSize: 0 },
      { name: "package/assets/data/a.json", body: "{}" },
    ]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when
      const result = extractTarball(archive, dest)

      //#then
      expect(result.files).toEqual(["assets/data/a.json"])
      expect(existsSync(path.join(dest, "assets/link"))).toBe(false)
      expect(existsSync(path.join(dest, "assets/hard"))).toBe(false)
    })
  })

  test("applies the filter to the stripped path", () => {
    //#given
    const entries: FixtureEntry[] = [
      { name: "package/assets/data/a.json", body: "{}" },
      { name: "package/assets/skills/demo/SKILL.md", body: "# Demo" },
    ]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)
      const seen: string[] = []

      //#when
      const result = extractTarball(archive, dest, {
        filter: (relativePath) => {
          seen.push(relativePath)
          return relativePath.startsWith("assets/data/")
        },
      })

      //#then
      expect(result.files).toEqual(["assets/data/a.json"])
      expect(seen).toEqual(["assets/data/a.json", "assets/skills/demo/SKILL.md"])
      expect(existsSync(path.join(dest, "assets/skills/demo/SKILL.md"))).toBe(false)
    })
  })

  test("creates directories declared by type 5 entries that pass the filter", () => {
    //#given
    const entries: FixtureEntry[] = [
      { name: "package/assets/", type: "5" },
      { name: "package/assets/templates/", type: "5" },
    ]

    withTempDir((dir) => {
      const { archive, dest } = writeTgz(dir, entries)

      //#when
      const result = extractTarball(archive, dest)

      //#then
      expect(result.files).toEqual([])
      expect(existsSync(path.join(dest, "assets/templates"))).toBe(true)
    })
  })
})
