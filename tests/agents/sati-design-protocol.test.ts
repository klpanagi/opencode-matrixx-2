import { describe, expect, test } from "bun:test"
import { createSatiAgent } from "../../src/agents/definitions/sati"

/** Prompt length before the design-system protocol was added (recorded baseline). */
const BASELINE_PROMPT_LENGTH = 4009

/** Acceptance bound: the protocol must add less than 2 KB to the prompt. */
const MAX_PROMPT_DELTA = 2048

function satiSystemPrompt(): string {
  return String(createSatiAgent("anthropic/claude-opus-4-6").system)
}

function satiSkills(): string[] {
  const config = createSatiAgent("anthropic/claude-opus-4-6")
  return (config as Record<string, unknown>).skills as string[]
}

function protocolSection(): string {
  const prompt = satiSystemPrompt()
  const start = prompt.indexOf("## DESIGN SYSTEM PROTOCOL")
  const end = prompt.indexOf("## NO DELEGATION", start)
  return prompt.slice(start, end)
}

describe("sati design-system protocol", () => {
  //#given the sati system prompt
  //#when locating the design-system protocol heading
  //#then the protocol section exists before the no-delegation section
  test("prompt contains the DESIGN SYSTEM PROTOCOL section", () => {
    const prompt = satiSystemPrompt()

    expect(prompt).toContain("## DESIGN SYSTEM PROTOCOL")
    expect(prompt.indexOf("## DESIGN SYSTEM PROTOCOL")).toBeLessThan(
      prompt.indexOf("## NO DELEGATION")
    )
  })

  //#given the protocol section
  //#when reading the selector matrix
  //#then hint wins, then the installed pack, then the built-in default
  test("selector is ordered hint -> installed pack -> frontend-ui-ux", () => {
    const section = protocolSection()

    const hintIndex = section.indexOf("1. **Explicit hint**")
    const packIndex = section.indexOf("2. **Installed pack**")
    const defaultIndex = section.indexOf("3. **Default**")

    expect(hintIndex).toBeGreaterThan(-1)
    expect(packIndex).toBeGreaterThan(hintIndex)
    expect(defaultIndex).toBeGreaterThan(packIndex)

    const hintStep = section.slice(hintIndex, packIndex)
    const packStep = section.slice(packIndex, defaultIndex)
    const defaultStep = section.slice(defaultIndex)

    expect(hintStep).toContain("design_skill: <name>")
    expect(hintStep).toContain("`skill`")
    expect(packStep).toContain("ui-ux-pro-max")
    expect(packStep).toContain("`skill`")
    expect(defaultStep).toContain("`frontend-ui-ux`")
  })

  //#given the protocol section
  //#when scanning for the uiux tooling requirements
  //#then both tools and the MASTER.md source of truth are named
  test("protocol names uiux_design_system, uiux_search and MASTER.md", () => {
    const section = protocolSection()

    expect(section).toContain("`uiux_design_system`")
    expect(section).toContain("MASTER.md")
    expect(section).toContain("`uiux_search`")
  })

  //#given the protocol section
  //#when checking the delivery contract and token discipline
  //#then the design skill is reported and hardcoded tokens are forbidden
  test("requires a Design skill delivery note and forbids hardcoded tokens", () => {
    const section = protocolSection()

    expect(section).toContain("`Design skill: <name>`")
    expect(section).toContain("Never hardcode palette, spacing, or type values")
  })

  //#given the protocol section
  //#when scanning the unavailable-tool guidance
  //#then it degrades to the loaded skill instead of failing the task
  test("falls back to the loaded skill when uiux tools are unavailable", () => {
    const section = protocolSection()

    expect(section).toContain("unavailable")
    expect(section).toContain("is not a task failure")
  })
})

describe("sati static skill list", () => {
  //#given the agent config
  //#when reading the attached skills
  //#then exactly the 8 built-in frontend skills are attached
  test("keeps exactly 8 attached frontend skills", () => {
    const skills = satiSkills()

    expect(skills).toEqual([
      "react-nextjs-patterns",
      "svelte-sveltekit-patterns",
      "frontend-a11y",
      "frontend-perf",
      "frontend-testing",
      "frontend-state-data",
      "frontend-build-tooling",
      "playwright",
    ])
  })

  //#given the agent config
  //#when reading the attached skills
  //#then the pack skill stays loadable instead of being inlined
  test("does not include ui-ux-pro-max in the attached skills", () => {
    const skills = satiSkills()

    expect(skills).not.toContain("ui-ux-pro-max")
    expect(skills).toHaveLength(8)
  })

  //#given the skill usage wording and table
  //#when reading the prompt
  //#then the old attached-only claim is gone and the pack row is marked loadable
  test("describes built-in skills as attached and the pack as loadable", () => {
    const prompt = satiSystemPrompt()

    expect(prompt).not.toContain("You have 8 skills attached.")
    expect(prompt).toContain("8 built-in frontend skills attached")
    expect(prompt).toContain("`ui-ux-pro-max` | Design-system generation")
    expect(prompt).toContain("(loadable, not inlined)")
  })
})

describe("sati prompt size budget", () => {
  //#given the recorded pre-protocol prompt length
  //#when measuring the current prompt
  //#then the protocol addition stays under 2 KB
  test("prompt delta stays under 2048 characters", () => {
    const prompt = satiSystemPrompt()
    const delta = prompt.length - BASELINE_PROMPT_LENGTH

    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThan(MAX_PROMPT_DELTA)
  })
})
