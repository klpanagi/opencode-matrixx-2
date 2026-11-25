/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { clearLazyTemplateCache } from "../../../src/skills/loader/lazy-skill-helper"
import { createBuiltinSkills } from "../../../src/skills/loader/factories"

const FACTORIES_PATH = resolve(import.meta.dir, "../../../src/skills/loader/factories.ts")

/**
 * Architectural gate for P5 (T8): the skill table must resolve skill modules
 * through per-name `require()` loaders so `bun build --splitting` emits them as
 * chunks instead of evaluating all 70 modules inside `dist/index.js` at load.
 *
 * A static `import ... from "../builtin/..."` at the top of this file drags the
 * whole skill tree back into the main bundle, which is exactly the regression
 * this test exists to catch.
 */
describe("skill loader module shape (P5)", () => {
  const source = readFileSync(FACTORIES_PATH, "utf8")

  test("has no static skill imports", () => {
    //#given the loader source
    //#when scanning for static imports of the builtin skill tree
    const staticSkillImports = source.match(/from\s+["']\.\.\/builtin\//g) ?? []

    //#then none remain — skill modules are only reachable through lazy loaders
    expect(staticSkillImports).toEqual([])
  })

  test("declares one lazy require loader per skill", () => {
    //#given the skillFactories table
    //#when counting per-name loaders
    const loaders = source.match(/\(\)\s*=>\s*require\("\.\.\/builtin\//g) ?? []

    //#then every documented builtin skill has an on-demand loader
    expect(loaders.length).toBeGreaterThanOrEqual(68)
  })
})

describe("createBuiltinSkills lazy module loading", () => {
  test("resolves every returned skill on demand", () => {
    //#given the builtin skill list
    const skills = createBuiltinSkills()

    //#when every template is hydrated through the lazy require loaders
    const hydrated = skills.map((skill) => ({ name: skill.name, template: skill.template }))

    //#then each skill resolves a non-empty template and names stay unique
    expect(hydrated.length).toBe(70)
    for (const { name, template } of hydrated) {
      expect(typeof name).toBe("string")
      expect(template.length).toBeGreaterThan(0)
    }
    expect(new Set(hydrated.map((s) => s.name)).size).toBe(hydrated.length)
  })

  test("hydrates description from the lazily loaded module", () => {
    //#given a freshly constructed lazy skill
    clearLazyTemplateCache()
    const skills = createBuiltinSkills()
    const gitMaster = skills.find((s) => s.name === "git-master")
    expect(gitMaster).toBeDefined()

    //#when the template getter runs the require loader once
    const template = gitMaster?.template ?? ""

    //#then the description comes from the same loaded module
    expect(template.length).toBeGreaterThan(100)
    expect(gitMaster?.description.length ?? 0).toBeGreaterThan(0)
  })

  test("does not fabricate skills for unregistered names", () => {
    //#given the default provider
    const names = createBuiltinSkills().map((s) => s.name)

    //#then non-selected browser siblings stay out of the list
    expect(names).not.toContain("agent-browser")
    expect(names).not.toContain("playwright-cli")
    expect(names).toContain("playwright")
  })

  test("still honours disabledSkills filtering", () => {
    //#given a disabled non-browser skill
    const skills = createBuiltinSkills({ disabledSkills: new Set(["git-master"]) })

    //#then it is filtered out after lazy construction
    expect(skills.map((s) => s.name)).not.toContain("git-master")
    expect(skills).toHaveLength(69)
  })
})
