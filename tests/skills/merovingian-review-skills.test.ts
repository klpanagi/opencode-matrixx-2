import { describe, expect, test } from "bun:test"
import { createMerovingianAgent, ORACLE_PROMPT_METADATA } from "../../src/agents/merovingian"
import { createBuiltinSkills } from "../../src/skills/skills"
import { MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_NAME } from "../../src/skills/skills/market-data-robustness-review"
import { RESILIENCE_FAILURE_HUNTING_SKILL_NAME } from "../../src/skills/skills/resilience-failure-hunting"

const NEW_SKILLS = [MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_NAME, RESILIENCE_FAILURE_HUNTING_SKILL_NAME]

describe("merovingian review skills (neo/tank consolidation)", () => {
  test("both skills are registered by createBuiltinSkills", () => {
    //#given the default builtin skill set
    //#when the factory runs
    const skills = createBuiltinSkills()

    //#then both consolidation skills resolve by name
    for (const name of NEW_SKILLS) {
      expect(skills.find((s) => s.name === name)).toBeDefined()
    }
  })

  test("merovingian loads both skills", () => {
    //#given a model
    //#when the merovingian config is built
    const config = createMerovingianAgent("anthropic/claude-sonnet-4-5") as unknown as { skills: string[] }

    //#then it carries the two review skills from neo/tank
    for (const name of NEW_SKILLS) {
      expect(config.skills).toContain(name)
    }
  })

  test("merovingian metadata covers both review triggers", () => {
    //#given the merovingian prompt metadata
    //#when domains and useWhen are read
    const domains = ORACLE_PROMPT_METADATA.triggers.map((t) => t.domain).join("\n")
    const useWhen = (ORACLE_PROMPT_METADATA.useWhen ?? []).join("\n")

    //#then the old neo/tank key-trigger domains are named
    expect(domains).toMatch(/Market-Data Pipeline Review/i)
    expect(domains).toMatch(/Silent-Failure Hunting/i)
    expect(useWhen).toMatch(/market-data pipeline review/i)
    expect(useWhen).toMatch(/silent failures/i)
  })
})
