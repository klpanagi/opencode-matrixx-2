/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  isSoftwareDevExecutorTarget,
  isSoftwareDevOrchestratorTarget,
  resolveSoftwareDevEnforcementContent,
  softwareDevDisabledSkillError,
} from "../../../src/shared/software-dev-enforcement"

describe("shared software-dev enforcement: orchestrator targets", () => {
  test("default orchestrator set matches case-insensitively", () => {
    //#given the built-in orchestrator defaults (morpheus/keymaker/niobe/oracle)
    //#when each default name (plus case variants) is classified
    const matched = ["morpheus", "KEYMAKER", "Niobe", "oracle"].map((name) =>
      isSoftwareDevOrchestratorTarget(name),
    )

    //#then all match
    expect(matched).toEqual([true, true, true, true])
  })

  test("custom orchestrators list redefines the full-template set", () => {
    //#given a custom orchestrator allow-list
    const enforcement = { orchestrators: ["oracle"] }

    //#when non-listed and listed agents are classified
    //#then only the listed agent matches
    expect(isSoftwareDevOrchestratorTarget("morpheus", enforcement)).toBe(false)
    expect(isSoftwareDevOrchestratorTarget("oracle", enforcement)).toBe(true)
  })

  test("empty or undefined agent is never an orchestrator target", () => {
    //#given missing agent identities
    //#when classified
    //#then neither matches
    expect(isSoftwareDevOrchestratorTarget(undefined)).toBe(false)
    expect(isSoftwareDevOrchestratorTarget("")).toBe(false)
  })

  test("orchestrator target resolves the FULL software-dev template", () => {
    //#given an orchestrator delegation with no caller skills
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("morpheus", undefined, [])

    //#then the full template (TEAM ROLES) is returned with no error
    expect(result.error).toBeNull()
    expect(String(result.content)).toContain("TEAM ROLES")
  })

  test("orchestrator dedupe: caller-passed software-dev is not appended twice", () => {
    //#given an orchestrator delegation already carrying software-dev
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("oracle", undefined, ["software-dev"])

    //#then nothing is appended and no error is raised
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("blocked software-dev skill fails closed even with enabled=false", () => {
    //#given an orchestrator delegation with software-dev explicitly disabled
    //#when enforcement content is resolved under the master kill-switch
    const result = resolveSoftwareDevEnforcementContent("oracle", undefined, [], {
      enforcement: { enabled: false },
      disabledSkills: new Set(["software-dev"]),
    })

    //#then the disabled-skill error wins (highest precedence)
    expect(result.content).toBeUndefined()
    expect(String(result.error)).toContain("disabled_skills")
    expect(String(result.error)).toContain("software-dev")
  })
})

describe("shared software-dev enforcement: executor targets", () => {
  test("executor helper matches mouse only", () => {
    //#given executor vs orchestrator agent names
    //#when classified
    //#then only mouse matches
    expect(isSoftwareDevExecutorTarget("mouse")).toBe(true)
    expect(isSoftwareDevExecutorTarget("oracle")).toBe(false)
    expect(isSoftwareDevExecutorTarget(undefined)).toBe(false)
  })

  test("mouse+source missing tdd-enforcer fails closed naming tdd-enforcer", () => {
    //#given a Mouse code-writing delegation with no caller skills
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", [])

    //#then it fails closed naming the required skill
    expect(result.content).toBeUndefined()
    expect(String(result.error)).toContain("tdd-enforcer")
  })

  test("mouse+source with tdd-enforcer appends git-master only, never orchestrator strings", () => {
    //#given a Mouse code-writing delegation already carrying tdd-enforcer
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", ["tdd-enforcer"])

    //#then only the missing subset template is appended
    expect(result.error).toBeNull()
    expect(String(result.content)).toContain("# Git Master Agent")
    expect(String(result.content)).not.toContain("# TDD Enforcer")
    expect(String(result.content)).not.toContain("TEAM ROLES")
  })

  test("mouse with non-code-writing category returns no payload", () => {
    //#given a Mouse delegation outside code-writing categories
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("mouse", "construct", ["tdd-enforcer"])

    //#then nothing is appended and no error is raised
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("autoAppend mode appends the subset without throwing", () => {
    //#given a Mouse code-writing delegation under autoAppend mode
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", [], {
      enforcement: { mode: "autoAppend" },
    })

    //#then both subset templates are appended with no error
    expect(result.error).toBeNull()
    expect(String(result.content)).toContain("# TDD Enforcer")
    expect(String(result.content)).toContain("# Git Master Agent")
  })

  test("disabled tdd-enforcer fails closed and wins over enabled=false", () => {
    //#given a Mouse code-writing delegation with tdd-enforcer explicitly disabled
    //#when enforcement content is resolved under the master kill-switch
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", [], {
      enforcement: { enabled: false },
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then the disabled-skill error wins, nothing is injected
    expect(result.content).toBeUndefined()
    expect(String(result.error)).toContain("tdd-enforcer")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("enabled=false exempts source absent explicit disabled entries", () => {
    //#given a Mouse code-writing delegation under the master kill-switch
    //#when enforcement content is resolved with no disabled entries
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", [], {
      enforcement: { enabled: false },
    })

    //#then nothing is appended and no error is raised
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })
})

describe("shared software-dev enforcement: non-targets and error text", () => {
  test("unknown subagent returns no payload", () => {
    //#given a read-only agent delegation
    //#when enforcement content is resolved
    const result = resolveSoftwareDevEnforcementContent("trinity", undefined, [])

    //#then nothing is appended and no error is raised
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("disabled-skill error text names the skill and the escape hatch", () => {
    //#given a required skill name
    //#when the fail-closed error is built
    const error = softwareDevDisabledSkillError("tdd-enforcer")

    //#then the text names the skill, the disabled_skills channel, and never stays silent
    expect(error).toContain("tdd-enforcer")
    expect(error).toContain("disabled_skills")
  })
})
