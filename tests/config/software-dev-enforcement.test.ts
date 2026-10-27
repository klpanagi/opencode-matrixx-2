/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  MatrixxConfigSchema,
  resolveSoftwareDevEnforcement,
  SoftwareDevEnforcementConfigSchema,
  SOFTWARE_DEV_ENFORCEMENT_DEFAULT_EXECUTORS_SUBSET,
  SOFTWARE_DEV_ENFORCEMENT_DEFAULT_ORCHESTRATORS,
} from "../../src/config/schema"
import { requireTddEnforcerForCodeWriting } from "../../src/tools/delegate-task/tools"
import {
  isSoftwareDevExecutorTarget,
  isSoftwareDevOrchestratorTarget,
} from "../../src/tools/delegate-task/software-dev-enforcement"

describe("softwareDevEnforcement schema defaults", () => {
  test("defaults to full built-in behavior when input is empty", () => {
    //#given
    const raw = {}

    //#when
    const result = SoftwareDevEnforcementConfigSchema.parse(raw)

    //#then
    expect(result.enabled).toBe(true)
    expect(result.enforceOnContinuations).toBe(true)
    expect(result.mode).toBe("failClosed")
    expect(result.orchestrators).toEqual([...SOFTWARE_DEV_ENFORCEMENT_DEFAULT_ORCHESTRATORS])
    expect(result.executorsSubset).toEqual([...SOFTWARE_DEV_ENFORCEMENT_DEFAULT_EXECUTORS_SUBSET])
  })

  test("resolves defaults via MatrixxConfig when the block is empty", () => {
    //#given
    const raw = { softwareDevEnforcement: {} }

    //#when
    const result = MatrixxConfigSchema.parse(raw)

    //#then
    expect(result.softwareDevEnforcement?.enabled).toBe(true)
    expect(result.softwareDevEnforcement?.mode).toBe("failClosed")
  })

  test("absent softwareDevEnforcement key resolves to enabled via helper", () => {
    //#given
    const raw = {}

    //#when
    const parsed = MatrixxConfigSchema.parse(raw)
    const result = resolveSoftwareDevEnforcement(parsed.softwareDevEnforcement)

    //#then
    expect(result.enabled).toBe(true)
    expect(result.enforceOnContinuations).toBe(true)
  })

  test("rejects executorsSubset containing software-dev", () => {
    //#given
    const raw = { executorsSubset: ["tdd-enforcer", "software-dev"] }

    //#when
    const result = SoftwareDevEnforcementConfigSchema.safeParse(raw)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects executorsSubset containing software-dev case-insensitively", () => {
    //#given
    const raw = { executorsSubset: ["Software-Dev"] }

    //#when
    const result = SoftwareDevEnforcementConfigSchema.safeParse(raw)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts custom orchestrators redefining the full-template set", () => {
    //#given
    const raw = { orchestrators: ["oracle"] }

    //#when
    const result = SoftwareDevEnforcementConfigSchema.parse(raw)

    //#then
    expect(result.orchestrators).toEqual(["oracle"])
  })
})

describe("softwareDevEnforcement precedence", () => {
  test("enabled=false exempts source (master kill-switch)", () => {
    //#given
    const category = "source"
    const loadSkills: string[] = []

    //#when
    const error = requireTddEnforcerForCodeWriting(category, loadSkills, {
      enforcement: { enabled: false },
    })

    //#then
    expect(error).toBeNull()
  })

  test("explicit disabled_skills tdd-enforcer entry fails closed with actionable error", () => {
    //#given
    const category = "source"
    const loadSkills = ["tdd-enforcer"]

    //#when
    const error = requireTddEnforcerForCodeWriting(category, loadSkills, {
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then
    expect(typeof error).toBe("string")
    expect(String(error)).toContain("tdd-enforcer")
    expect(String(error)).toContain("disabled_skills")
  })

  test("explicit disabled entry wins over enabled=false (highest precedence)", () => {
    //#given
    const category = "source"
    const loadSkills: string[] = []

    //#when
    const error = requireTddEnforcerForCodeWriting(category, loadSkills, {
      enforcement: { enabled: false },
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then
    expect(typeof error).toBe("string")
    expect(String(error)).toContain("disabled_skills")
  })

  test("tdd_enforcer off does not flow into the new guard (invariant preserved)", () => {
    //#given
    const category = "source"
    const loadSkills: string[] = []

    //#when
    const error = requireTddEnforcerForCodeWriting(category, loadSkills, {})

    //#then
    expect(typeof error).toBe("string")
    expect(String(error)).toContain("tdd-enforcer")
  })

  test("resolveSoftwareDevEnforcement applies field values over built-in defaults", () => {
    //#given
    const input = { orchestrators: ["oracle"], mode: "autoAppend" as const }

    //#when
    const result = resolveSoftwareDevEnforcement(input)

    //#then
    expect(result.orchestrators).toEqual(["oracle"])
    expect(result.mode).toBe("autoAppend")
    expect(result.enabled).toBe(true)
  })
})

describe("software-dev resolved-target helpers", () => {
  test("morpheus/keymaker/niobe/oracle match the default orchestrator set case-insensitively", () => {
    //#when
    const matched = ["morpheus", "KEYMAKER", "Niobe", "oracle"].map((name) =>
      isSoftwareDevOrchestratorTarget(name),
    )

    //#then
    expect(matched).toEqual([true, true, true, true])
  })

  test("custom orchestrators list redefines the full-template set", () => {
    //#given
    const enforcement = { orchestrators: ["oracle"] }

    //#when
    const morpheus = isSoftwareDevOrchestratorTarget("morpheus", enforcement)
    const oracle = isSoftwareDevOrchestratorTarget("oracle", enforcement)

    //#then
    expect(morpheus).toBe(false)
    expect(oracle).toBe(true)
  })

  test("executor helper matches mouse only", () => {
    //#when
    const mouse = isSoftwareDevExecutorTarget("mouse")
    const oracle = isSoftwareDevExecutorTarget("oracle")

    //#then
    expect(mouse).toBe(true)
    expect(oracle).toBe(false)
  })
})
