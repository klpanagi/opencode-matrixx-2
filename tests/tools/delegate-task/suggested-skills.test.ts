import { describe, expect, test } from "bun:test"
import { BuiltinSkillNameSchema } from "../../../src/config/schema/agent-names"
import { CATEGORY_SUGGESTED_SKILLS, getSuggestedSkillsForCategory } from "../../../src/tools/delegate-task/constants"
import { buildSystemContent } from "../../../src/tools/delegate-task/prompt-builder"

describe("category suggested skills", () => {
  test("every category has at least one suggestion, all names valid", () => {
    //#given
    const valid = new Set(BuiltinSkillNameSchema.options)
    //#when
    for (const category of ["construct", "source", "deep-jack", "matrix-bend", "bullet-time", "blue-pill", "red-pill", "broadcast"]) {
      const suggested = getSuggestedSkillsForCategory(category)
      //#then
      expect(suggested.length).toBeGreaterThan(0)
      for (const name of suggested) expect(valid.has(name)).toBe(true)
    }
  })

  test("source suggests tdd-enforcer first", () => {
    //#given
    //#when
    const suggested = getSuggestedSkillsForCategory("source")
    //#then
    expect(suggested[0]).toBe("tdd-enforcer")
  })

  test("unknown category returns empty list", () => {
    //#given
    //#when
    const suggested = getSuggestedSkillsForCategory("nope")
    //#then
    expect(suggested).toEqual([])
  })

  test("hint appended when no skill content given", () => {
    //#given
    //#when
    const content = buildSystemContent({ category: "source", categoryPromptAppend: "CTX" })
    //#then
    expect(content).toContain("CTX")
    expect(content).toContain("tdd-enforcer")
  })

  test("no hint when skill content already provided", () => {
    //#given
    //#when
    const content = buildSystemContent({ category: "source", skillContent: "SKILLS", categoryPromptAppend: "CTX" })
    //#then
    expect(content).not.toContain("Suggested_Skills")
  })
})
