/// <reference types="bun-types" />
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

// Unmockable real fs: mock.module("node:fs") below is process-wide in bun, so
// the suite's own setup and assertions use this direct registry handle.
const realFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs")

const PACK_ID = "slides"
const PACK_VERSION = "9.9.9"
const TARBALL_URL = "https://registry.test/ui-ux-pro-max-cli/-/ui-ux-pro-max-cli-9.9.9.tgz"

/** Destination of the staging-to-final rename we can force to fail. */
let failRenameTo: string | null = null

const renameSyncMock = mock((from: string, to: string) => {
  // Only the swap out of the staging directory fails; the backup move and the
  // restore move must keep working or the test would not prove a rollback.
  if (failRenameTo !== null && to === failRenameTo && from.includes(".staging-")) {
    throw new Error("simulated rename failure")
  }
  realFs.renameSync(from, to)
})

mock.module("node:fs", () => ({ ...realFs, renameSync: renameSyncMock }))

// Import after mocks
import { installPack } from "../../../src/cli/skill-pack/installer"

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = realFs.mkdtempSync(join(tmpdir(), "matrixx-skill-pack-installer-"))
  tempRoots.push(root)
  return root
}

/** One ustar header plus its padded payload. */
function tarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf-8")
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, "utf-8")
  header.write("0000644\0", 100, "utf-8")
  header.write("0000000\0", 108, "utf-8")
  header.write("0000000\0", 116, "utf-8")
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "utf-8")
  header.write("00000000000\0", 136, "utf-8")
  header.write("        ", 148, "utf-8")
  header.write("0", 156, "utf-8")
  header.write("ustar\0", 257, "utf-8")
  header.write("00", 263, "utf-8")

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "utf-8")

  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length)
  return Buffer.concat([header, data, padding])
}

/** A gzipped pack tarball whose `slides` payload carries the given marker. */
function buildTarball(marker: string): Buffer {
  const entries = [
    tarEntry("package/assets/skills/slides/SKILL.md", `# slides ${marker}\n`),
    tarEntry("package/assets/skills/brand/SKILL.md", "# brand\n"),
  ]
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))
}

/** Registry stub serving the packument and the tarball for one marker. */
function makeFetch(marker: string): { fetchFn: typeof fetch; integrity: string } {
  const tarball = buildTarball(marker)
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`

  const fetchFn = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith(".tgz")) return new Response(tarball)

    return new Response(
      JSON.stringify({
        version: PACK_VERSION,
        dist: { integrity, tarball: TARBALL_URL, shasum: "", unpackedSize: 0, fileCount: 0 },
      }),
      { headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch

  return { fetchFn, integrity }
}

/** Installs the fixture pack at one version with the given payload marker. */
async function installMarker(
  root: string,
  marker: string,
  options: { force?: boolean } = {},
): Promise<Awaited<ReturnType<typeof installPack>>> {
  const { fetchFn, integrity } = makeFetch(marker)
  return installPack({
    packId: PACK_ID,
    version: PACK_VERSION,
    root,
    force: options.force ?? false,
    fetchFn,
    pinnedIntegrity: integrity,
  })
}

afterEach(() => {
  failRenameTo = null
})

afterAll(() => {
  // mock.module("node:fs") outlives mock.restore(): re-register a transparent
  // registry so later suites observe the real filesystem.
  mock.module("node:fs", () => realFs)
  mock.restore()

  for (const root of tempRoots.splice(0)) {
    realFs.rmSync(root, { recursive: true, force: true })
  }
})

describe("installPack crash safety", () => {
  test("a failed staging-to-final rename leaves the working install in place", async () => {
    //#given version 1 is installed and its lock and payload are on disk
    const root = makeTempRoot()
    const first = await installMarker(root, "v1")
    const lockPath = join(first.dir, "lock.json")
    const skillPath = join(first.dir, "skills", "slides", "SKILL.md")
    const lockBefore = realFs.readFileSync(lockPath, "utf-8")

    //#when replacing it fails while the staging directory is renamed onto the installed one
    failRenameTo = first.dir
    const replacing = installMarker(root, "v2", { force: true })

    //#then the failure is surfaced, but version 1 is restored intact
    await expect(replacing).rejects.toThrow("simulated rename failure")
    expect(realFs.existsSync(first.dir)).toBe(true)
    expect(realFs.readFileSync(lockPath, "utf-8")).toBe(lockBefore)
    expect(realFs.readFileSync(skillPath, "utf-8")).toContain("slides v1")

    //#then the restore consumed the backup: only the version directory remains
    expect(realFs.readdirSync(join(root, PACK_ID))).toEqual([PACK_VERSION])
  })

  test("a successful replacement swaps the payload and removes the backup", async () => {
    //#given version 1 is installed
    const root = makeTempRoot()
    const first = await installMarker(root, "v1")

    //#when the same version is replaced
    const second = await installMarker(root, "v2", { force: true })

    //#then the payload is the new one and no backup directory survives
    expect(second.dir).toBe(first.dir)
    const skillPath = join(second.dir, "skills", "slides", "SKILL.md")
    expect(realFs.readFileSync(skillPath, "utf-8")).toContain("slides v2")
    expect(realFs.existsSync(join(second.dir, "lock.json"))).toBe(true)

    const packRoot = join(root, PACK_ID)
    expect(realFs.readdirSync(packRoot)).toEqual([PACK_VERSION])
  })
})
