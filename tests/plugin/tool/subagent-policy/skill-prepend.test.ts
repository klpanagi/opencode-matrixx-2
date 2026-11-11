/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { applySkillPrepend, readLoadSkills } from "../../../../src/plugin/tool/subagent-policy/skill-prepend"

function fakeResolver(map: Record<string, string>) {
  return (skills: string[], _options: unknown) => {
    const missing = skills.filter((s) => !(s in map))
    if (missing.length > 0) {
      return { content: undefined, error: `Skills not found: ${missing.join(", ")}` }
    }
    return { content: skills.map((s) => map[s]).join("\n\n"), error: null }
  }
}

describe("readLoadSkills", () => {
  test("returns undefined when key absent", () => {
    //#given
    const args: Record<string, unknown> = { agent: "mouse-source", prompt: "hello" }

    //#when
    const result = readLoadSkills(args)

    //#then
    expect(result).toBeUndefined()
  })

  test("throws on non-array load_skills", () => {
    //#given
    const args: Record<string, unknown> = { load_skills: "tdd-enforcer" }

    //#when / #then
    expect(() => readLoadSkills(args)).toThrow("load_skills")
  })
})

describe("applySkillPrepend", () => {
  test("skill-less call leaves prompt byte-identical", () => {
    //#given
    const prompt = "Fix the bug in src/foo.ts line 42."
    const args: Record<string, unknown> = { agent: "mouse-source", prompt }

    //#when
    const skills = applySkillPrepend(args, fakeResolver({}))

    //#then
    expect(skills).toEqual([])
    expect(args.prompt).toBe(prompt)
    expect(args.prompt).toBe("Fix the bug in src/foo.ts line 42.")
  })

  test("resolves skills and prepends content, removing the key", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "do the thing",
      load_skills: ["tdd-enforcer"],
    }

    //#when
    const skills = applySkillPrepend(
      args,
      fakeResolver({ "tdd-enforcer": "<TDD>content</TDD>" }),
    )

    //#then
    expect(skills).toEqual(["tdd-enforcer"])
    expect(args.prompt).toBe("<TDD>content</TDD>\n\ndo the thing")
    expect(args).not.toHaveProperty("load_skills")
  })

  test("unknown skill throws naming the skill (never silent drop)", () => {
    //#given
    const args: Record<string, unknown> = {
      agent: "mouse-source",
      prompt: "do the thing",
      load_skills: ["nope-missing"],
    }

    //#when / #then
    expect(() => applySkillPrepend(args, fakeResolver({}))).toThrow("nope-missing")
    expect(args.prompt).toBe("do the thing")
  })

  test("empty skill list is a no-op on prompt but removes key", () => {
    //#given
    const args: Record<string, unknown> = { prompt: "keep me", load_skills: [] }

    //#when
    applySkillPrepend(args, fakeResolver({}))

    //#then
    expect(args.prompt).toBe("keep me")
    expect(args).not.toHaveProperty("load_skills")
  })
})
