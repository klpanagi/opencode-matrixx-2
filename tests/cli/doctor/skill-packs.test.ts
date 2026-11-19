import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSkillPacksCheck, type SkillPacksCheckDeps } from "../../../src/cli/doctor/checks/skill-packs"
import { ALL_CHECKS, getChecksByCategory, skillPacksCheck } from "../../../src/cli/doctor/checks"
import { PACK_LOCK_FILENAME, writeLockAtomic } from "../../../src/skills/packs/store"
import type { PackLock } from "../../../src/skills/packs/types"
import { PINNED_INTEGRITY } from "../../../src/cli/skill-pack/constants"

const PYTHON_OK = { ok: true, version: "3.11.4" }

let root: string

function makeLock(overrides: Partial<PackLock> = {}): PackLock {
  return {
    packId: "ui-ux-pro-max",
    version: "2.15.0",
    integrity: PINNED_INTEGRITY,
    sourceUrl: "https://example.test/ui-ux-pro-max.tgz",
    installedAt: "2026-01-01T00:00:00.000Z",
    files: ["skills/ui-ux-pro-max/SKILL.md"],
    skills: [{ name: "ui-ux-pro-max", skillRoot: "skills/ui-ux-pro-max", files: ["skills/ui-ux-pro-max/SKILL.md"] }],
    risks: ["requiresPython"],
    pythonRequired: true,
    ...overrides,
  }
}

function writePack(lock: PackLock, options: { coreSkill?: boolean } = {}): string {
  const dir = join(root, lock.packId, lock.version)
  writeLockAtomic(dir, lock)
  if (options.coreSkill !== false) {
    const skillDir = join(dir, "skills", "ui-ux-pro-max")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: ui-ux-pro-max\ndescription: core\n---\nbody\n", "utf-8")
  }
  return dir
}

function deps(overrides: SkillPacksCheckDeps = {}): SkillPacksCheckDeps {
  return {
    readConfig: () => ({}),
    resolveRoot: () => root,
    resolvePython: () => "python3",
    probe: () => PYTHON_OK,
    ...overrides,
  }
}

async function run(overrides: SkillPacksCheckDeps = {}) {
  return createSkillPacksCheck(deps(overrides)).check()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "matrixx-doctor-packs-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("skillPacksCheck", () => {
  test("is registered in ALL_CHECKS under dependencies", () => {
    //#given/#when
    const names = ALL_CHECKS.map((check) => check.name)
    const categoryNames = getChecksByCategory("dependencies").map((check) => check.name)

    //#then
    expect(names).toContain("skill-packs")
    expect(categoryNames).toContain("skill-packs")
    expect(skillPacksCheck.category).toBe("dependencies")
  })

  test("passes with an add hint when no packs are installed", async () => {
    //#given/#when
    const result = await run()

    //#then
    expect(result.status).toBe("pass")
    expect(result.message).toContain("no skill packs installed")
    expect(result.message).toContain("matrixx skill add ui-ux-pro-max")
  })

  test("passes without scanning when skill packs are disabled", async () => {
    //#given
    const readConfig = () => ({ enabled: false })

    //#when
    const result = await run({ readConfig })

    //#then
    expect(result.status).toBe("pass")
    expect(result.message).toContain("disabled")
  })

  test("passes for a healthy core pack with pinned integrity and Python", async () => {
    //#given
    writePack(makeLock())

    //#when
    const result = await run({ readConfig: () => ({ allow_network_packs: true }) })

    //#then
    expect(result.status).toBe("pass")
    expect(result.message).toContain("ui-ux-pro-max 2.15.0")
    expect(result.message).toContain("Python 3.11.4")
  })

  test("warns with an install hint when Python is missing", async () => {
    //#given
    writePack(makeLock())

    //#when
    const result = await run({ resolvePython: () => undefined })

    //#then
    expect(result.status).toBe("warn")
    expect(result.detail ?? "").toContain("Install Python 3 (python3)")
  })

  test("fails with a remove/add fix when the lockfile is corrupt", async () => {
    //#given
    const dir = join(root, "ui-ux-pro-max", "2.15.0")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, PACK_LOCK_FILENAME), "{ not json", "utf-8")

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("fail")
    expect(result.message).toContain("corrupt lock")
    expect(result.detail ?? "").toContain(
      "matrixx skill remove ui-ux-pro-max && matrixx skill add ui-ux-pro-max",
    )
  })

  test("warns when the installed version differs from the pinned version", async () => {
    //#given
    writePack(makeLock({ version: "2.14.0" }))

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("warn")
    expect(result.detail ?? "").toContain("2.14.0")
    expect(result.detail ?? "").toContain("2.15.0")
  })

  test("fails when the recorded integrity does not match the pinned digest", async () => {
    //#given
    writePack(makeLock({ integrity: "sha512-tampered" }))

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("fail")
    expect(result.message).toContain("integrity")
  })

  test("warns with consent hints for network and API-key risk flags", async () => {
    //#given
    writePack(
      makeLock({
        packId: "design",
        risks: ["requiresApiKeys", "requiresNetwork", "requiresPython"],
      }),
    )
    const dir = join(root, "design", "2.15.0", "skills", "ui-ux-pro-max")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), "---\nname: ui-ux-pro-max\ndescription: core\n---\n", "utf-8")

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("warn")
    expect(result.detail ?? "").toContain("--allow-network")
    expect(result.detail ?? "").toContain("--allow-api-keys")
  })

  test("fails when the core pack is missing its core skill", async () => {
    //#given
    writePack(makeLock(), { coreSkill: false })

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("fail")
    expect(result.detail ?? "").toContain("skills/ui-ux-pro-max/SKILL.md")
  })

  test("aggregates multiple installed packs into one result", async () => {
    //#given
    writePack(makeLock())
    writePack(makeLock({ packId: "slides", risks: [], pythonRequired: false, skills: [] }))
    const slidesDir = join(root, "slides", "2.15.0", "skills")
    mkdirSync(slidesDir, { recursive: true })

    //#when
    const result = await run()

    //#then
    expect(result.status).toBe("pass")
    expect(result.message).toContain("ui-ux-pro-max")
    expect(result.message).toContain("slides")
  })

  test("never throws for an unreadable config or root", async () => {
    //#given
    const readConfig = () => {
      throw new Error("boom")
    }
    const resolveRoot = () => {
      throw new Error("boom")
    }

    //#when
    const result = await run({ readConfig, resolveRoot })

    //#then
    expect(result.status).toBe("pass")
  })
})
