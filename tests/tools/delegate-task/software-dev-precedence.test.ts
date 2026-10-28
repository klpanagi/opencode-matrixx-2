/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { SoftwareDevEnforcementConfigInput } from "../../../src/config/schema"
import { resolveSoftwareDevEnforcementContent } from "../../../src/tools/delegate-task/software-dev-payload"
import { requireTddEnforcerForCodeWriting } from "../../../src/tools/delegate-task/tools"

type GuardOptions = {
  enforcement?: SoftwareDevEnforcementConfigInput | null
  disabledSkills?: Set<string> | string[]
}

describe("precedence locks: blocked-skill error always surfaces (never silently bypassed)", () => {
  test("orchestrator + software-dev disabled fails closed naming the skill", () => {
    //#given an orchestrator delegation whose required skill is explicitly disabled
    //#when the post-resolution payload resolves
    const result = resolveSoftwareDevEnforcementContent("oracle", undefined, [], {
      disabledSkills: new Set(["software-dev"]),
    })

    //#then the blocked-skill error surfaces on the string channel, content stays empty
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("software-dev")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("orchestrator blocked-skill error wins over enabled=false", () => {
    //#given the master switch off but an explicit disabled entry for the required skill
    //#when the post-resolution payload resolves
    const result = resolveSoftwareDevEnforcementContent("oracle", undefined, [], {
      enforcement: { enabled: false },
      disabledSkills: new Set(["software-dev"]),
    })

    //#then the explicit entry still fails closed (never silently bypassed)
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("orchestrator blocked-skill error wins over autoAppend", () => {
    //#given autoAppend mode but an explicit disabled entry for the required skill
    //#when the post-resolution payload resolves
    const result = resolveSoftwareDevEnforcementContent("morpheus", undefined, [], {
      enforcement: { mode: "autoAppend" },
      disabledSkills: ["software-dev"],
    })

    //#then autoAppend never suppresses the blocked-skill notice
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("executor autoAppend + disabled tdd-enforcer still fails closed", () => {
    //#given autoAppend mode with the required executor skill explicitly disabled
    //#when the post-resolution payload resolves for mouse+source
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", [], {
      enforcement: { mode: "autoAppend" },
      disabledSkills: new Set(["tdd-enforcer"]),
    })

    //#then autoAppend suppresses only the missing-skill throw, never the blocked notice
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("tdd-enforcer")
    expect(String(result.error)).toContain("disabled_skills")
  })

  test("executor blocked non-tdd subset skill fails closed when tdd-enforcer is present", () => {
    //#given tdd-enforcer present but git-master explicitly disabled
    //#when the post-resolution payload resolves for mouse+source
    const result = resolveSoftwareDevEnforcementContent("mouse", "source", ["tdd-enforcer"], {
      disabledSkills: new Set(["git-master"]),
    })

    //#then the blocked subset skill fails closed naming git-master
    expect(result.content).toBeUndefined()
    expect(typeof result.error).toBe("string")
    expect(String(result.error)).toContain("git-master")
    expect(String(result.error)).toContain("disabled_skills")
  })
})

describe("precedence locks: enabled=false exempts everything else", () => {
  test("orchestrator + enabled=false yields no payload and no error", () => {
    //#given the master switch off and nothing disabled
    //#when the post-resolution payload resolves for an orchestrator
    const result = resolveSoftwareDevEnforcementContent("oracle", undefined, [], {
      enforcement: { enabled: false },
    })

    //#then everything is exempt: no content, no error
    expect(result.error).toBeNull()
    expect(result.content).toBeUndefined()
  })

  test("guard: source + enabled=false is exempt (null)", () => {
    //#given the master switch off at the pre-resolution guard
    const options: GuardOptions = { enforcement: { enabled: false } }

    //#when the guard runs for source without the skill
    const error = requireTddEnforcerForCodeWriting("source", [], options)

    //#then the delegation is exempt
    expect(error).toBeNull()
  })

  test("guard: source + autoAppend suppresses the missing-skill throw (null)", () => {
    //#given autoAppend mode at the pre-resolution guard
    const options: GuardOptions = { enforcement: { mode: "autoAppend" } }

    //#when the guard runs for source without the skill
    const error = requireTddEnforcerForCodeWriting("source", [], options)

    //#then only the missing-skill throw is suppressed
    expect(error).toBeNull()
  })
})

describe("precedence locks: explicit disabled entry wins at the pre-resolution guard", () => {
  test("guard: disabled tdd-enforcer fails closed even with enabled=false", () => {
    //#given an explicit disabled entry plus the master switch off
    const options: GuardOptions = {
      enforcement: { enabled: false },
      disabledSkills: new Set(["tdd-enforcer"]),
    }

    //#when the guard runs for source
    const error = requireTddEnforcerForCodeWriting("source", [], options)

    //#then the explicit entry still fails closed
    expect(typeof error).toBe("string")
    expect(String(error)).toContain("tdd-enforcer")
    expect(String(error)).toContain("disabled_skills")
  })

  test("guard: disabled tdd-enforcer fails closed even under autoAppend", () => {
    //#given an explicit disabled entry plus autoAppend mode
    const options: GuardOptions = {
      enforcement: { mode: "autoAppend" },
      disabledSkills: ["tdd-enforcer"],
    }

    //#when the guard runs for source
    const error = requireTddEnforcerForCodeWriting("source", [], options)

    //#then autoAppend never suppresses the blocked-skill notice
    expect(typeof error).toBe("string")
    expect(String(error)).toContain("tdd-enforcer")
    expect(String(error)).toContain("disabled_skills")
  })
})
