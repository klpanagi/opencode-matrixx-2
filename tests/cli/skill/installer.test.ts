import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { gzipSync } from "node:zlib"
import { PINNED_PACK_VERSION } from "../../../src/cli/skill-pack/constants"
import {
  installPack,
  listPacks,
  PackAlreadyInstalledError,
  PackRequiresConsentError,
  PackUnknownError,
  PinnedIntegrityMismatchError,
  removePack,
} from "../../../src/cli/skill-pack/installer"
import { IntegrityMismatchError } from "../../../src/cli/skill-pack/integrity"
import { PACK_CATALOG } from "../../../src/skills/packs/catalog"
import { readLock } from "../../../src/skills/packs/store"

const BLOCK = 512
const ZERO_BLOCK = Buffer.alloc(BLOCK)
const TARBALL_URL = "https://fixture.test/ui-ux-pro-max-cli-2.15.0.tgz"
const CORE_ID = "ui-ux-pro-max"
const AUX_IDS = ["design-system", "brand", "slides", "banner-design", "ui-styling", "design"] as const

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "matrixx-installer-"))
  tempRoots.push(root)
  return root
}

interface FixtureEntry {
  name: string
  body?: string
  type?: string
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0").slice(0, length - 1)
  buffer.write(encoded, offset, "ascii")
  buffer[offset + length - 1] = 0
}

function ustarHeader(name: string, size: number, typeflag: string): Buffer {
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
  const header = ustarHeader(entry.name, body.length, entry.type ?? "0")
  const padding = Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK)
  return Buffer.concat([header, body, padding])
}

const BASE_TEMPLATE = [
  "# {{TITLE}}",
  "",
  "{{DESCRIPTION}}",
  "",
  "Run: python3 {{SCRIPT_PATH}} --domain colors",
  "",
  "Type: {{SKILL_OR_WORKFLOW}}",
  "{{QUICK_REFERENCE}}",
].join("\n")

function skillDocument(name: string): string {
  return ["---", `name: ${name}`, `description: ${name} description`, "---", `# ${name}`, ""].join("\n")
}

function fixtureEntries(): FixtureEntry[] {
  const entries: FixtureEntry[] = [
    { name: "package/assets/templates/base/skill-content.md", body: BASE_TEMPLATE },
    { name: "package/assets/templates/base/quick-reference.md", body: "## Quick Reference\nQR-MARKER" },
    { name: "package/assets/data/colors/colors.csv", body: "name,hex\nteal,#008080" },
    { name: "package/assets/scripts/search.py", body: "print('search')" },
    { name: "package/assets/scripts/tests/test_search.py", body: "def test_search(): pass" },
  ]
  for (const id of AUX_IDS) {
    entries.push({ name: `package/assets/skills/${id}/SKILL.md`, body: skillDocument(id) })
  }
  entries.push({ name: "package/assets/skills/design-system/scripts/run.js", body: "console.log('run')" })
  return entries
}

function fixtureTgz(): Buffer {
  return gzipSync(Buffer.concat([...fixtureEntries().map(tarEntry), ZERO_BLOCK, ZERO_BLOCK]))
}

function sri(buffer: Buffer): string {
  return `sha512-${createHash("sha512").update(buffer).digest("base64")}`
}

interface FixtureFetchOptions {
  /** Digest served in the packument instead of the fixture's real digest. */
  packumentIntegrity?: string
  /** Serve bytes that do not match the packument digest. */
  tamperTarball?: boolean
}

function fixtureFetch(tgz: Buffer, integrity: string, options: FixtureFetchOptions = {}) {
  const calls: string[] = []
  const fetchFn: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url === TARBALL_URL) {
      const body = options.tamperTarball === true ? Buffer.from("tampered-bytes") : tgz
      return new Response(new Uint8Array(body))
    }
    return new Response(
      JSON.stringify({
        version: PINNED_PACK_VERSION,
        dist: { tarball: TARBALL_URL, integrity: options.packumentIntegrity ?? integrity },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }
  return { fetchFn, calls }
}

function versionDir(root: string, packId: string): string {
  return path.join(root, packId, PINNED_PACK_VERSION)
}

function stagingLeftovers(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => name.startsWith(".staging-"))
}

describe("installPack", () => {
  test("installs the core pack, renders SKILL.md, copies data/scripts and writes the lock", async () => {
    //#given a fixture tarball served with its own pinned digest
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)

    //#when installing the core pack
    const result = await installPack({
      packId: CORE_ID,
      root,
      fetchFn,
      pinnedIntegrity: integrity,
    })

    //#then the version directory holds the generated core skill
    const dir = versionDir(root, CORE_ID)
    expect(result.dir).toBe(dir)
    expect(result.skills).toEqual([CORE_ID])
    const skillFile = path.join(dir, "skills", CORE_ID, "SKILL.md")
    expect(existsSync(skillFile)).toBe(true)
    expect(existsSync(path.join(dir, "skills", CORE_ID, "data", "colors", "colors.csv"))).toBe(true)
    expect(existsSync(path.join(dir, "skills", CORE_ID, "scripts", "search.py"))).toBe(true)
    expect(existsSync(path.join(dir, "skills", CORE_ID, "scripts", "tests", "test_search.py"))).toBe(false)

    const document = readFileSync(skillFile, "utf8")
    expect(document).toContain("Run: python3")
    expect(document).toContain(path.join(dir, "skills", CORE_ID, "scripts", "search.py"))

    //#and the lock records provenance, files and risks
    const lock = readLock(dir)
    expect(lock).not.toBeNull()
    expect(lock?.integrity).toBe(integrity)
    expect(lock?.sourceUrl).toBe(TARBALL_URL)
    expect(lock?.risks).toEqual(["requiresPython"])
    expect(lock?.pythonRequired).toBe(true)
    expect(lock?.packId).toBe(CORE_ID)
    expect(lock?.version).toBe(PINNED_PACK_VERSION)
    expect(Number.isNaN(Date.parse(lock?.installedAt ?? ""))).toBe(false)
    expect(lock?.files).toContain("skills/ui-ux-pro-max/SKILL.md")
    expect(lock?.files).toContain("skills/ui-ux-pro-max/data/colors/colors.csv")
    expect(lock?.files.some((file) => file.startsWith("assets/"))).toBe(false)
    expect(lock?.files).not.toContain("lock.json")
    expect(lock?.skills).toEqual([
      {
        name: CORE_ID,
        skillRoot: "skills/ui-ux-pro-max",
        files: expect.arrayContaining(["skills/ui-ux-pro-max/SKILL.md"]),
      },
    ])

    //#and nothing is left in staging
    expect(stagingLeftovers(root)).toEqual([])
  })

  test("installs only the requested auxiliary pack skill", async () => {
    //#given a fixture tarball with every auxiliary skill
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)

    //#when installing design-system
    const result = await installPack({
      packId: "design-system",
      root,
      fetchFn,
      pinnedIntegrity: integrity,
    })

    //#then only that skill directory is materialised
    const dir = versionDir(root, "design-system")
    expect(result.skills).toEqual(["design-system"])
    expect(existsSync(path.join(dir, "skills", "design-system", "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(dir, "skills", "design-system", "scripts", "run.js"))).toBe(true)
    expect(existsSync(path.join(dir, "skills", "brand", "SKILL.md"))).toBe(false)
    const lock = readLock(dir)
    expect(lock?.risks).toEqual(["requiresNode"])
    expect(lock?.pythonRequired).toBe(false)
  })

  test("installs every catalog pack once consent flags are supplied", async () => {
    //#given a fresh root and the fixture tarball
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)

    //#when installing the whole catalog
    for (const pack of PACK_CATALOG) {
      await installPack({
        packId: pack.id,
        root,
        fetchFn,
        pinnedIntegrity: integrity,
        allowNetworkPacks: true,
        allowApiKeyPacks: true,
      })
    }

    //#then every catalog skill has a SKILL.md and every pack is listed
    for (const pack of PACK_CATALOG) {
      for (const skill of pack.skills) {
        expect(existsSync(path.join(versionDir(root, pack.id), "skills", skill, "SKILL.md"))).toBe(true)
      }
    }
    expect(listPacks({ root })).toHaveLength(PACK_CATALOG.length)
  })

  test("rejects an unknown pack before touching the network", async () => {
    //#given a fetch spy that must stay untouched
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const { fetchFn, calls } = fixtureFetch(tgz, sri(tgz))

    //#when installing a pack that is not in the catalog
    const attempt = installPack({ packId: "does-not-exist", root, fetchFn })

    //#then the typed error fires and nothing was fetched
    await expect(attempt).rejects.toBeInstanceOf(PackUnknownError)
    expect(calls).toEqual([])
  })

  test("blocks network packs unless allowNetworkPacks is set", async () => {
    //#given ui-styling requires network access
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const { fetchFn, calls } = fixtureFetch(tgz, sri(tgz))

    //#when installing without the network flag
    let error: unknown
    try {
      await installPack({ packId: "ui-styling", root, fetchFn })
    } catch (caught) {
      error = caught
    }

    //#then consent is required and no request went out
    expect(error).toBeInstanceOf(PackRequiresConsentError)
    expect((error as PackRequiresConsentError).risks).toEqual(["requiresNetwork"])
    expect(calls).toEqual([])
  })

  test("still blocks api-key packs when only the network flag is set", async () => {
    //#given design requires both network and provider API keys
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const { fetchFn, calls } = fixtureFetch(tgz, sri(tgz))

    //#when allowing the network but not API keys
    let error: unknown
    try {
      await installPack({ packId: "design", root, fetchFn, allowNetworkPacks: true })
    } catch (caught) {
      error = caught
    }

    //#then only the api-key risk is reported and nothing was fetched
    expect(error).toBeInstanceOf(PackRequiresConsentError)
    expect((error as PackRequiresConsentError).risks).toEqual(["requiresApiKeys"])
    expect(calls).toEqual([])
  })

  test("aborts before download when the packument digest is not pinned", async () => {
    //#given a packument that advertises a different digest than the pin
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const foreignIntegrity = sri(Buffer.from("some-other-release"))
    const { fetchFn, calls } = fixtureFetch(tgz, integrity, { packumentIntegrity: foreignIntegrity })

    //#when installing with the real pin
    const attempt = installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })

    //#then the mismatch is typed, no tarball was fetched and nothing was written
    await expect(attempt).rejects.toBeInstanceOf(IntegrityMismatchError)
    await expect(attempt).rejects.toBeInstanceOf(PinnedIntegrityMismatchError)
    expect(calls).toEqual([`https://registry.npmjs.org/ui-ux-pro-max-cli/${PINNED_PACK_VERSION}`])
    expect(existsSync(versionDir(root, CORE_ID))).toBe(false)
    expect(stagingLeftovers(root)).toEqual([])
  })

  test("rejects a tampered tarball and leaves no partial pack", async () => {
    //#given integrity matches the pinned value but the served bytes differ
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity, { tamperTarball: true })

    //#when installing
    const attempt = installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })

    //#then verification fails and no pack directory or staging survives
    await expect(attempt).rejects.toBeInstanceOf(IntegrityMismatchError)
    expect(existsSync(versionDir(root, CORE_ID))).toBe(false)
    expect(stagingLeftovers(root)).toEqual([])
  })

  test("dry-run verifies the download but writes nothing", async () => {
    //#given a root that does not exist yet
    const root = path.join(tempRoot(), "never-created")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn, calls } = fixtureFetch(tgz, integrity)

    //#when installing in dry-run mode
    const result = await installPack({
      packId: CORE_ID,
      root,
      dryRun: true,
      fetchFn,
      pinnedIntegrity: integrity,
    })

    //#then the planned result is returned and the filesystem is untouched
    expect(result.dir).toBe(versionDir(root, CORE_ID))
    expect(result.skills).toEqual([CORE_ID])
    expect(result.lock.files).toEqual([])
    expect(result.lock.integrity).toBe(integrity)
    expect(calls).toHaveLength(2)
    expect(existsSync(root)).toBe(false)
  })

  test("refuses to overwrite an existing install without force", async () => {
    //#given one successful install
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)
    await installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })

    //#when installing the same version again
    const attempt = installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })

    //#then the typed already-installed error fires
    await expect(attempt).rejects.toBeInstanceOf(PackAlreadyInstalledError)
  })

  test("force replaces an existing install atomically", async () => {
    //#given an install plus an untracked marker file
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)
    await installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })
    const dir = versionDir(root, CORE_ID)
    writeFileSync(path.join(dir, "marker.txt"), "stale")

    //#when reinstalling with force
    await installPack({ packId: CORE_ID, root, force: true, fetchFn, pinnedIntegrity: integrity })

    //#then the old directory was swapped out and staging is clean
    expect(existsSync(path.join(dir, "marker.txt"))).toBe(false)
    expect(existsSync(path.join(dir, "skills", CORE_ID, "SKILL.md"))).toBe(true)
    expect(stagingLeftovers(root)).toEqual([])
  })
})

describe("removePack and listPacks", () => {
  test("lists installed packs and removes one version", async () => {
    //#given one installed pack
    const root = path.join(tempRoot(), "packs")
    const tgz = fixtureTgz()
    const integrity = sri(tgz)
    const { fetchFn } = fixtureFetch(tgz, integrity)
    await installPack({ packId: CORE_ID, root, fetchFn, pinnedIntegrity: integrity })

    //#when listing and then removing it
    const listed = listPacks({ root })
    const removed = removePack(CORE_ID, { root })

    //#then the summary matches and the directory is gone
    expect(listed).toHaveLength(1)
    expect(listed[0]?.packId).toBe(CORE_ID)
    expect(listed[0]?.version).toBe(PINNED_PACK_VERSION)
    expect(removed).toEqual([versionDir(root, CORE_ID)])
    expect(listPacks({ root })).toEqual([])
  })

  test("lists an empty result for a missing root", () => {
    //#given a root that was never created
    const root = path.join(tempRoot(), "missing")

    //#when listing packs
    const listed = listPacks({ root })

    //#then nothing is reported
    expect(listed).toEqual([])
  })
})
