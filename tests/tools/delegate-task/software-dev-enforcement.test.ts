/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test"
import { createBuiltinSkills } from "../../../src/skills"
import { isCodeWritingCategory } from "../../../src/tools/delegate-task/constants"
import { buildSystemContent } from "../../../src/tools/delegate-task/prompt-builder"
import { resolveSoftwareDevEnforcementContent } from "../../../src/tools/delegate-task/software-dev-payload"
import { SoftwareDevEnforcementConfigSchema } from "../../../src/config/schema"

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"

function createSyncHarness() {
  //#given a sync-execution harness mirroring tools.test.ts (captures the prompt body)
  const { createDelegateTask } = require("../../../src/tools/delegate-task/tools")
  let promptBody: { system?: string } = {}

  const promptMock = async (input: { system?: string }) => {
    promptBody = input
    return { data: {} }
  }

  const mockClient = {
    session: {
      get: async () => ({ data: { directory: "/project" } }),
      create: async () => ({ data: { id: "ses_sde_wiring" } }),
      prompt: promptMock,
      promptAsync: promptMock,
      messages: async () => ({
        data: [{ type: "assistant", content: [{ type: "text", text: "Done" }] }]
      }),
      status: async () => ({ data: {} }),
      abort: mock(() => Promise.resolve())
    },
    config: { get: async () => ({ data: { model: SYSTEM_DEFAULT_MODEL } }) },
    app: { agents: async () => ({ data: [] }) }
  }

  const tool = createDelegateTask({
    manager: { launch: async () => ({}) },
    client: mockClient
  })

  const toolContext = {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "morpheus",
    abort: new AbortController().signal
  }

  return { tool, toolContext, getPromptBody: () => promptBody }
}

describe("software-dev enforcement: Mouse subset composed through buildSystemContent", () => {
  test("mouse+source subset joined into systemContent carries no orchestrator delegation strings", () => {
    //#given resolved Mouse enforcement content for source with tdd-enforcer already present
    const resolved = resolveSoftwareDevEnforcementContent("mouse", "source", ["tdd-enforcer"])

    //#when the subset is composed through buildSystemContent exactly as tools.ts does
    expect(resolved.error).toBeNull()
    const systemContent = buildSystemContent({
      skillContent: resolved.content,
      agentName: "mouse",
      category: "source"
    })

    //#then full-template / delegation strings are absent, subset + single banner present
    expect(typeof systemContent).toBe("string")
    expect(String(systemContent)).toContain("# Git Master Agent")
    expect(String(systemContent)).not.toContain("# TDD Enforcer")
    expect(String(systemContent)).not.toContain("TEAM ROLES")
    expect(String(systemContent)).not.toContain('subagent_type="oracle"')
    expect(String(systemContent)).not.toContain('subagent_type="sentinel"')
    expect(String(systemContent)).not.toContain("Software Development Pipeline")
    expect(String(systemContent).split("NO IMPLEMENTATION WITHOUT A FAILING TEST FIRST").length - 1).toBe(1)
    expect(String(systemContent).indexOf("# Git Master Agent")).toBeLessThan(
      String(systemContent).indexOf("NO IMPLEMENTATION WITHOUT A FAILING TEST FIRST"),
    )
  })

  test("mouse+source with both subset skills present yields no enforcement content", () => {
    //#given both tdd-enforcer and git-master already supplied by the caller
    const loadSkills = ["tdd-enforcer", "git-master"]

    //#when the resolver runs for the Mouse executor target
    const resolved = resolveSoftwareDevEnforcementContent("mouse", "source", loadSkills)

    //#then nothing is appended (complete dedupe) and no error is raised
    expect(resolved.error).toBeNull()
    expect(resolved.content).toBeUndefined()
  })

  test("subset skill templates never embed the TDD banner (single-append invariant)", () => {
    //#given the built-in tdd-enforcer and git-master templates (spec section 6)
    const skills = createBuiltinSkills()
    const subset = skills.filter((s) => s.name === "tdd-enforcer" || s.name === "git-master")

    //#when their template text is inspected
    //#then the banner marker is absent, so prompt-builder appends it exactly once
    expect(subset.length).toBe(2)
    for (const skill of subset) {
      expect(skill.template).not.toContain("<TDD_Test_First>")
    }
  })
})

describe("software-dev enforcement: creation-path wiring keyed off resolved target", () => {
  test("category=source resolves to Mouse and injects the subset (never the full template)", async () => {
    //#given a source delegation carrying only tdd-enforcer
    const { tool, toolContext, getPromptBody } = createSyncHarness()

    //#when the tool executes (category path always fans to Mouse post-resolution)
    await tool.execute(
      {
        description: "Wiring subset test",
        prompt: "Do something",
        category: "source",
        run_in_background: false,
        load_skills: ["tdd-enforcer"]
      },
      toolContext,
    )

    //#then the captured prompt system holds the subset, the banner once, and no orchestrator strings
    const system = String(getPromptBody().system ?? "")
    expect(system).toContain("# TDD Enforcer")
    expect(system).toContain("# Git Master Agent")
    expect(system.split("<TDD_Test_First>").length - 1).toBe(1)
    expect(system).not.toContain("TEAM ROLES")
    expect(system).not.toContain('subagent_type="oracle"')
    expect(system).not.toContain('subagent_type="sentinel"')
    expect(system).not.toContain("Software Development Pipeline")
  }, { timeout: 20000 })

  test("category=source with both subset skills present injects nothing twice", async () => {
    //#given a source delegation already carrying the full Mouse subset
    const { tool, toolContext, getPromptBody } = createSyncHarness()

    //#when the tool executes
    await tool.execute(
      {
        description: "Wiring no-dup test",
        prompt: "Do something",
        category: "source",
        run_in_background: false,
        load_skills: ["tdd-enforcer", "git-master"]
      },
      toolContext,
    )

    //#then enforcement adds no duplicate copy of either template
    const system = String(getPromptBody().system ?? "")
    expect(system.split("# Git Master Agent").length - 1).toBe(1)
    expect(system.split("# TDD Enforcer").length - 1).toBe(1)
  }, { timeout: 20000 })

  test("category=source without tdd-enforcer fails closed at the creation path", async () => {
    //#given a source delegation missing the required skill
    const { tool, toolContext } = createSyncHarness()

    //#when the tool executes
    //#then it rejects naming tdd-enforcer (fail-closed, never silent)
    await expect(
      tool.execute(
        {
          description: "Wiring fail-closed test",
          prompt: "Do something",
          category: "source",
          run_in_background: false,
          load_skills: []
        },
        toolContext,
      ),
    ).rejects.toThrow("tdd-enforcer")
  }, { timeout: 20000 })
})

describe("software-dev enforcement: continuation one-site inheritance", () => {
  const FORBIDDEN = [
    "resolveSkillContent",
    "buildSystemContent",
    "resolveSoftwareDevEnforcementContent",
    "requireTddEnforcerForCodeWriting",
    "softwareDevDisabledSkillError",
    "isCodeWritingCategory",
    "TDD_TEST_FIRST_APPEND",
    "software-dev",
  ]

  test("sync continuation reuses stored context and re-derives no enforcement", async () => {
    //#given the one-site verdict (decisions.md 2026-10-27T16:35Z): creation-only enforcement
    const source = await Bun.file(
      new URL("../../../src/tools/delegate-task/sync-continuation.ts", import.meta.url),
    ).text()

    //#when the continuation module source is scanned
    //#then no enforcement resolver or skill-content recomputation is referenced
    for (const token of FORBIDDEN) {
      expect(source.includes(token)).toBe(false)
    }
  })

  test("background continuation reuses stored context and re-derives no enforcement", async () => {
    //#given the one-site verdict (decisions.md 2026-10-27T16:35Z): creation-only enforcement
    const source = await Bun.file(
      new URL("../../../src/tools/delegate-task/background-continuation.ts", import.meta.url),
    ).text()

    //#when the continuation module source is scanned
    //#then no enforcement resolver or skill-content recomputation is referenced
    for (const token of FORBIDDEN) {
      expect(source.includes(token)).toBe(false)
    }
  })

  test("enforceOnContinuations accepts both true and false (schema-reserved flag)", () => {
    //#given explicit values for the continuation flag in both states
    //#when each is parsed
    const enabled = SoftwareDevEnforcementConfigSchema.parse({ enforceOnContinuations: true })
    const disabled = SoftwareDevEnforcementConfigSchema.parse({ enforceOnContinuations: false })

    //#then both round-trip with remaining defaults intact
    expect(enabled.enforceOnContinuations).toBe(true)
    expect(disabled.enforceOnContinuations).toBe(false)
    expect(disabled.enabled).toBe(true)
    expect(disabled.mode).toBe("failClosed")
  })
})

describe("isCodeWritingCategory single source of truth", () => {
  test("source is the only code-writing category (construct excluded, exact match)", () => {
    //#given every known category plus edge-case spellings
    //#when each is classified
    //#then only exact "source" matches
    expect(isCodeWritingCategory("source")).toBe(true)
    for (const category of [
      "construct",
      "deep-jack",
      "matrix-bend",
      "bullet-time",
      "blue-pill",
      "red-pill",
      "broadcast",
      undefined,
      "",
      "Source",
      "SOURCE",
      " source",
    ]) {
      expect(isCodeWritingCategory(category)).toBe(false)
    }
  })
})
