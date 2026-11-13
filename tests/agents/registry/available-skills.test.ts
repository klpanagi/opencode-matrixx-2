import { beforeEach, describe, expect, test } from "bun:test"
import { buildAvailableSkills } from "../../../src/agents/registry/available-skills"
import { clearLazyTemplateCache } from "../../../src/skills/loader/lazy-skill-helper"

describe("buildAvailableSkills — lazy skill description hydration", () => {
  beforeEach(() => {
    clearLazyTemplateCache()
  })

  test("returns a real description for every builtin skill", () => {
    //#given builtin skills beyond the eagerly-resolved browser skill are lazy
    //       wrappers whose description starts empty until template hydration
    //#when the available-skills table is built for an agent prompt
    const available = buildAvailableSkills([])

    //#then every entry carries real domain text, not an empty column
    expect(available.length).toBeGreaterThan(0)
    for (const skill of available) {
      expect(`${skill.name}:${skill.description.length > 4}`).toBe(`${skill.name}:true`)
    }
  })

  test("a known lazy skill resolves its real description", () => {
    //#given a skill that resolves through the lazy template wrapper
    //#when the available-skills table is built
    const available = buildAvailableSkills([])
    const descriptionByName = new Map(available.map((skill) => [skill.name, skill.description]))

    //#then its description is non-empty
    expect(descriptionByName.get("playwright") ?? "").not.toBe("")
    expect((descriptionByName.get("tdd-enforcer") ?? "").length).toBeGreaterThan(4)
  })

  test("a second build returns the same descriptions (idempotent)", () => {
    //#given an already-built available-skills table
    const first = buildAvailableSkills([])

    //#when the table is built again
    const second = buildAvailableSkills([])

    //#then descriptions are stable across calls
    expect(second.map((skill) => [skill.name, skill.description])).toEqual(
      first.map((skill) => [skill.name, skill.description]),
    )
  })
})
