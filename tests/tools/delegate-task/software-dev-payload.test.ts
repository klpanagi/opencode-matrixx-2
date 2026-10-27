/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { resolveSoftwareDevEnforcementContent } from "../../../src/tools/delegate-task/software-dev-payload"

describe("resolveSoftwareDevEnforcementContent (spec split-payloads sections 4-9)", () => {
  test("orchestrator targets get FULL template containing TEAM ROLES (case-insensitive)", () => {
    //#given
    const targets = ["morpheus", "KEYMAKER", "Niobe", "ORACLE"]

    //#when
    const results = targets.map((agentToUse) =>
      resolveSoftwareDevEnforcementContent(agentToUse, undefined, []),
    )

    //#then
    for (const result of results) {
      expect(result.error).toBeNull()
      expect(typeof result.content).toBe("string")
      expect(String(result.content)).toContain("TEAM ROLES")
    }
  })

  test("orchestrator dedupe: caller-passed software-dev is not appended twice", () => {
    //#given
    const agentToUse = "oracle"
    const loadSkills = ["software-dev"]

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, undefined, loadSkills)

    //#then
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("mouse+source missing tdd-enforcer fails closed naming tdd-enforcer", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills)

    //#then
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("tdd-enforcer")
  })

  test("mouse+source with tdd-enforcer appends git-master only, never orchestrator strings", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills = ["tdd-enforcer"]

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills)

    //#then
    expect(result.error).toBeNull()
    expect(typeof result.content).toBe("string")
    expect(String(result.content)).toContain("# Git Master Agent")
    expect(String(result.content)).not.toContain("# TDD Enforcer")
    expect(String(result.content)).not.toContain("TEAM ROLES")
    expect(String(result.content)).not.toContain('subagent_type="oracle"')
    expect(String(result.content)).not.toContain('subagent_type="sentinel"')
  })

  test("mouse with non-code-writing category returns no payload", () => {
    //#given
    const agentToUse = "mouse"
    const categories = [
      "construct",
      "deep-jack",
      "matrix-bend",
      "bullet-time",
      "blue-pill",
      "red-pill",
      "broadcast",
      undefined,
    ] as const

    //#when
    const results = categories.map((resolvedCategory) =>
      resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, []),
    )

    //#then
    for (const result of results) {
      expect(result.error).toBeNull()
      expect(result.content).toBeUndefined()
    }
  })

  test("unknown subagent returns no payload", () => {
    //#given
    const agentToUse = "trinity"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, undefined, loadSkills)

    //#then
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("error path with empty agentToUse returns no payload and no error", () => {
    //#given
    const agentToUse = ""
    const loadSkills: string[] = []

    //#when
    const source = resolveSoftwareDevEnforcementContent(agentToUse, "source", loadSkills)
    const bare = resolveSoftwareDevEnforcementContent(agentToUse, undefined, loadSkills)

    //#then
    expect(source.error).toBeNull()
    expect(source.content).toBeUndefined()
    expect(bare.error).toBeNull()
    expect(bare.content).toBeUndefined()
  })

  test("enabled=false exempts source (master kill-switch)", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills, {
      enforcement: { enabled: false },
    })

    //#then
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("disabled tdd-enforcer with source fails closed, never silently injects", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills, {
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("tdd-enforcer")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("explicit disabled entry wins over enabled=false", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills, {
      enforcement: { enabled: false },
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("autoAppend mode appends subset without throwing", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "source"
    const loadSkills: string[] = []

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills, {
      enforcement: { mode: "autoAppend" },
    })

    //#then
    expect(result.error).toBeNull()
    expect(typeof result.content).toBe("string")
    expect(String(result.content)).toContain("# TDD Enforcer")
    expect(String(result.content)).toContain("# Git Master Agent")
  })

  test("custom orchestrators redefine the full-template set", () => {
    //#given
    const enforcement = { orchestrators: ["oracle"] }

    //#when
    const morpheus = resolveSoftwareDevEnforcementContent("morpheus", undefined, [], { enforcement })
    const oracle = resolveSoftwareDevEnforcementContent("oracle", undefined, [], { enforcement })

    //#then
    expect(morpheus.error).toBeNull()
    expect(morpheus.content).toBeUndefined()
    expect(oracle.error).toBeNull()
    expect(String(oracle.content)).toContain("TEAM ROLES")
  })

  test("construct is excluded even for mouse with tdd-enforcer present (single source)", () => {
    //#given
    const agentToUse = "mouse"
    const resolvedCategory = "construct"
    const loadSkills = ["tdd-enforcer"]

    //#when
    const result = resolveSoftwareDevEnforcementContent(agentToUse, resolvedCategory, loadSkills)

    //#then
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })
})
