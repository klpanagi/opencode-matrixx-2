import { describe, expect, test } from "bun:test"
import type { AvailableAgent } from "../../src/agents/dynamic-agent-prompt-builder"
import { createKeymakerAgent } from "../../src/agents/keymaker"

const MODEL = "anthropic/claude-sonnet-4"

const SMITH_AGENT: AvailableAgent = {
  name: "smith",
  description: "Plan reviewer",
  metadata: {
    category: "advisor",
    cost: "EXPENSIVE",
    triggers: [{ domain: "Plan review", trigger: "Review work plans" }],
    useWhen: ["After Oracle creates a work plan"],
    avoidWhen: ["Trivial plans"],
  },
}

const buildWithSmith = () => createKeymakerAgent(MODEL, [SMITH_AGENT], []).system as string

describe("keymaker Smith chain directives", () => {
  test("renders the Smith pre-execution review section", () => {
    //#given a smith agent is available
    //#when the keymaker prompt is built
    const system = buildWithSmith()
    //#then the Smith section and its verdict contract are present
    expect(system).toContain("<Smith_Usage>")
    expect(system).toContain("[OKAY]")
    expect(system).toContain("[REJECT]")
    expect(system).toContain("max 3")
    expect(system).toContain("Cap 2")
    expect(system).toContain("Step-0")
    expect(system).toContain("EXECUTE + VERIFY")
  })

  test("references the canonical Oracle to Smith to EXECUTE example", () => {
    //#given a smith agent is available
    //#when the keymaker prompt is built
    const system = buildWithSmith()
    //#then the canonical example plan path is cited
    expect(system).toContain(".matrixx/plans/dcp-install-fix.md")
  })

  test("omits the Smith section when smith is not available", () => {
    //#given no agents available
    //#when the keymaker prompt is built
    const system = createKeymakerAgent(MODEL, [], []).system as string
    //#then no Smith section is rendered
    expect(system).not.toContain("<Smith_Usage>")
  })
})

describe("keymaker plan-only prohibition", () => {
  test("plan-only delivery can never be completion", () => {
    //#given a smith agent is available
    //#when the keymaker prompt is built
    const system = buildWithSmith()
    //#then the plan-only prohibition is stated
    expect(system).toContain("Plan-only prohibition")
    expect(system).toContain("NEVER completion")
  })
})

describe("keymaker infra-failure track", () => {
  test("classifies infra failures and gates workarounds before Oracle", () => {
    //#given a smith agent is available
    //#when the keymaker prompt is built
    const system = buildWithSmith()
    //#then the infra track and workaround gate are present
    expect(system).toContain("Infra-Failure Track")
    expect(system).toContain("Workaround gate")
    expect(system).toContain("transient")
    expect(system).toContain("version-arithmetic")
    expect(system).toContain("ERESOLVE")
  })
})

describe("keymaker oracle vs merovingian routing", () => {
  test("names both exact subagent_type values", () => {
    //#given a smith agent is available
    //#when the keymaker prompt is built
    const system = buildWithSmith()
    //#then both routing literals are present
    expect(system).toContain("subagent_type='oracle'")
    expect(system).toContain("subagent_type='merovingian'")
  })
})
