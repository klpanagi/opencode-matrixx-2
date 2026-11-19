/**
 * Gated end-to-end install test for the pinned `ui-ux-pro-max` skill pack.
 *
 * Off by default so CI stays offline: the suite runs only when
 * `MATRIXX_E2E_PACK=1` and a `python3` interpreter is available. It downloads
 * the pinned release tarball (~862 KB), installs it under a throwaway packs
 * root, and exercises search + design-system + validate against the real pack.
 *
 * A wrong pinned digest must abort before extraction, so the mismatch case
 * proves the installer never leaves a partially written pack behind.
 */
/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PINNED_INTEGRITY, PINNED_PACK_VERSION } from "../../../src/cli/skill-pack/constants"
import { installPack, PinnedIntegrityMismatchError } from "../../../src/cli/skill-pack/installer"
import { CORE_PACK_ID, PACK_PACKAGE_VERSION } from "../../../src/skills/packs/constants"
import { resolveCorePackRoot } from "../../../src/skills/packs/loader"
import { UIUX_MAX_STDOUT_BYTES } from "../../../src/tools/uiux/constants"
import { runUiuxDesignSystem, runUiuxSearch, runUiuxValidate } from "../../../src/tools/uiux/tools"
import type { UiuxToolDeps } from "../../../src/tools/uiux/types"

/** Budget for one test: the download is cached by the install in `beforeAll`. */
const E2E_TIMEOUT_MS = 120_000
/** Budget for the cold install: download plus staged extraction. */
const INSTALL_TIMEOUT_MS = 180_000
/** The slug the design-system script derives from `E2E Smoke`. */
const PROJECT_SLUG = "e2e-smoke"

/** True when a `python3` interpreter answers `--version`. */
function hasPython(): boolean {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf-8" })
  return probe.status === 0
}

/** True when any `__pycache__` directory exists under `dir`. */
function hasPycache(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === "__pycache__" || hasPycache(join(dir, entry.name))) return true
  }
  return false
}

const E2E_ENABLED = process.env.MATRIXX_E2E_PACK === "1"
// The interpreter probe only runs when the env gate is on, so a disabled suite
// spawns nothing and touches no files before it is skipped.
const PYTHON_AVAILABLE = E2E_ENABLED && hasPython()
const describeE2E = describe.skipIf(!E2E_ENABLED || !PYTHON_AVAILABLE)

describeE2E("ui-ux-pro-max end-to-end install", () => {
  const tempRoots: string[] = []
  let packsRoot = ""
  let rejectedRoot = ""
  let installedFiles = 0
  let installedVersion = ""
  let deps: UiuxToolDeps | undefined

  function toolDeps(): UiuxToolDeps {
    if (deps === undefined) throw new Error("the ui-ux-pro-max pack was not installed")
    return deps
  }

  beforeAll(async () => {
    //#given two throwaway packs roots, never the user's config directory
    packsRoot = mkdtempSync(join(tmpdir(), "matrixx-e2e-pack-"))
    rejectedRoot = mkdtempSync(join(tmpdir(), "matrixx-e2e-reject-"))
    tempRoots.push(packsRoot, rejectedRoot)

    //#when the pinned core pack is installed from the registry
    const result = await installPack({
      packId: CORE_PACK_ID,
      root: packsRoot,
      allowNetworkPacks: true,
    })

    //#then the lock records the payload and the pinned release identity
    installedFiles = result.lock.files.length
    installedVersion = result.version
    const coreSkillRoot = resolveCorePackRoot(CORE_PACK_ID, packsRoot)
    if (coreSkillRoot === undefined) throw new Error("resolveCorePackRoot found no installed pack")
    deps = {
      coreSkillRoot,
      pythonBin: "python3",
      timeoutMs: 20_000,
      maxStdoutBytes: UIUX_MAX_STDOUT_BYTES,
    }
  }, INSTALL_TIMEOUT_MS)

  afterAll(() => {
    deps = undefined
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(
    "installs the pinned release and records its files",
    () => {
      expect(installedVersion).toBe(PINNED_PACK_VERSION)
      expect(installedVersion).toBe(PACK_PACKAGE_VERSION)
      expect(installedFiles).toBeGreaterThan(0)
      expect(existsSync(join(toolDeps().coreSkillRoot, "SKILL.md"))).toBe(true)
    },
    E2E_TIMEOUT_MS,
  )

  test(
    "searches the installed knowledge base for style guidance",
    async () => {
      //#when a style query runs against the real pack
      const result = await runUiuxSearch(toolDeps(), {
        query: "glassmorphism dashboard",
        domain: "style",
        maxResults: 2,
      })

      //#then the script exits cleanly with ranked output
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.output.trim().length).toBeGreaterThan(0)
    },
    E2E_TIMEOUT_MS,
  )

  test(
    "persists a design system with MASTER.md",
    async () => {
      //#given a project directory outside the pack
      const projectDir = join(packsRoot, "project")

      //#when the design system is generated with persistence on
      const result = await runUiuxDesignSystem(toolDeps(), {
        project: "E2E Smoke",
        outputDir: projectDir,
        persist: true,
      })

      //#then MASTER.md exists at the persisted design-system path
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const expectedMaster = join(projectDir, "design-system", PROJECT_SLUG, "MASTER.md")
      const persisted = result.persisted ?? []
      expect(persisted).toContain(expectedMaster)
      expect(existsSync(expectedMaster)).toBe(true)
    },
    E2E_TIMEOUT_MS,
  )

  test(
    "validates every check without writing bytecode into the pack",
    async () => {
      //#when the installed pack is validated
      const result = await runUiuxValidate(toolDeps())

      //#then every non-skipped check passes and Python is available
      expect(result.ok).toBe(true)
      if (!("checks" in result)) return
      const executed = result.checks.filter((check) => check.skipped !== true)
      expect(executed.length).toBeGreaterThan(0)
      for (const check of executed) {
        expect({ name: check.name, ok: check.ok }).toEqual({ name: check.name, ok: true })
      }
      expect(result.python.ok).toBe(true)

      //#then no interpreter byproducts were written into the pack payload
      expect(hasPycache(toolDeps().coreSkillRoot)).toBe(false)
    },
    E2E_TIMEOUT_MS,
  )

  test(
    "aborts before writing when the pinned digest does not match",
    async () => {
      //#given a well-formed but wrong sha512 digest
      const wrongIntegrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`

      //#when the installer is asked to trust that digest
      //#then the registry digest is refused before any extraction
      await expect(
        installPack({
          packId: CORE_PACK_ID,
          root: rejectedRoot,
          allowNetworkPacks: true,
          pinnedIntegrity: wrongIntegrity,
        }),
      ).rejects.toBeInstanceOf(PinnedIntegrityMismatchError)
      expect(existsSync(join(rejectedRoot, CORE_PACK_ID))).toBe(false)
      expect(PINNED_INTEGRITY.startsWith("sha512-")).toBe(true)
    },
    E2E_TIMEOUT_MS,
  )
})
