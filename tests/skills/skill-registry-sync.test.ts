import { describe, expect, test } from "bun:test"
import { BuiltinSkillNameSchema } from "../../src/config/schema/agent-names"
import { createBuiltinSkills } from "../../src/skills/loader/factories"

describe("skill registry sync", () => {
  test("schema names match factory output, except documented playwright-cli alias", () => {
    //#given
    const schemaNames = new Set(BuiltinSkillNameSchema.options)

    //#when - union across browser providers covers the mutex
    const names = new Set<string>()
    for (const provider of ["playwright", "agent-browser", "playwright-cli"] as const) {
      for (const s of createBuiltinSkills({ browserProvider: provider })) names.add(s.name)
    }

    //#then - playwright-cli factory outputs canonical name "playwright" by design
    expect([...names].sort()).toEqual([...schemaNames].filter((n) => n !== "playwright-cli").sort())
    expect(schemaNames.has("playwright-cli")).toBe(true)
  })

  test("each provider returns total minus mutex siblings", () => {
    //#given
    const total = BuiltinSkillNameSchema.options.length

    //#when
    for (const provider of ["playwright", "agent-browser", "playwright-cli"] as const) {
      const skills = createBuiltinSkills({ browserProvider: provider })
      //#then - exactly one browser skill, rest shared
      expect(skills).toHaveLength(total - 2)
    }
  })

  test("browser mutex: exactly one browser skill per provider", () => {
    //#given - defaults
    //#when
    const def = createBuiltinSkills().map((s) => s.name)
    //#then
    expect(def).toContain("playwright")
    expect(def).not.toContain("agent-browser")

    //#when agent-browser provider
    const ab = createBuiltinSkills({ browserProvider: "agent-browser" }).map((s) => s.name)
    //#then
    expect(ab).toContain("agent-browser")
    expect(ab).not.toContain("playwright")
  })

  test("playwright-cli provider outputs canonical playwright name with CLI tools", () => {
    //#given
    const skills = createBuiltinSkills({ browserProvider: "playwright-cli" })
    //#when
    const skill = skills.find((s) => s.name === "playwright")
    //#then
    expect(skill).toBeDefined()
    expect(skill?.allowedTools).toContain("Bash(playwright-cli:*)")
    expect(skill?.template).toContain("playwright-cli open")
  })

  test("disabled_skills playwright-cli disables browser skill under that provider", () => {
    //#given
    const options = { browserProvider: "playwright-cli" as const, disabledSkills: new Set(["playwright-cli"]) }
    //#when
    const skills = createBuiltinSkills(options)
    //#then
    expect(skills.map((s) => s.name)).not.toContain("playwright")
    expect(skills).toHaveLength(BuiltinSkillNameSchema.options.length - 3)
  })
})
