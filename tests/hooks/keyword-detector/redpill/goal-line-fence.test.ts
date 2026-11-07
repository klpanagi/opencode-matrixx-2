/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createCipherAgent } from "../../../../src/agents/definitions/cipher"
import { createKeymakerAgent } from "../../../../src/agents/definitions/keymaker"
import { createMorpheusAgent } from "../../../../src/agents/definitions/morpheus"
import { createSentinelAgent } from "../../../../src/agents/definitions/sentinel"
import { REDPILL_DEEPSEEK_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/deepseek"
import { REDPILL_DEFAULT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/default"
import { REDPILL_GEMINI_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gemini"
import { REDPILL_GLM_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/glm"
import { REDPILL_GPT_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/gpt5.2"
import { REDPILL_MIMO_MESSAGE } from "../../../../src/hooks/keyword-detector/redpill/mimo"
import type { MatrixxConfig } from "../../../../src/config"
import { buildOracleAgentConfig } from "../../../../src/plugin/handlers/oracle-agent-config-builder"
import { denyTodoPermissions, deriveTaskPermissions } from "../../../../src/plugin/handlers/task-permissions"

type Rule = { action: string; resource?: string; effect: string }
import { applyToolConfig } from "../../../../src/plugin/handlers/tool-config-handler"

const MODEL = "anthropic/claude-sonnet-4-5"

/**
 * Every redpill variant now composes the shared Matrixx manifesto, so every
 * variant must ship the same fallback anchor. A variant that omits it is a
 * regression in the injected contract, not an intentional difference.
 */
const VARIANTS: {
  name: string;
  message: string;
  notepad: RegExp | null;
}[] = [
  {
    name: "default",
    message: REDPILL_DEFAULT_MESSAGE,
    notepad: /\bDurable Notepad\b/i,
  },
  {
    name: "deepseek",
    message: REDPILL_DEEPSEEK_MESSAGE,
    notepad: /\bDurable Notepad\b/i,
  },
  {
    name: "gemini",
    message: REDPILL_GEMINI_MESSAGE,
    // uppercase heading, heading level differs from default/deepseek
    notepad: /\bDurable Notepad\b/i,
  },
  {
    name: "gpt5.2",
    message: REDPILL_GPT_MESSAGE,
    // `##` here, `###` elsewhere — the regex is level-agnostic on purpose
    notepad: /\bDurable Notepad\b/i,
  },
  { name: "glm", message: REDPILL_GLM_MESSAGE, notepad: /\bDurable Notepad\b/i },
  { name: "mimo", message: REDPILL_MIMO_MESSAGE, notepad: /\bDurable Notepad\b/i },
]

/** Lines that name the tool at all — the surface a mandate would live on. */
function linesNamingTaskCreate(message: string): string[] {
  return message.split("\n").filter((line) => line.includes("`task_create`"))
}

describe("redpill goal line is capability-SAFE", () => {
  test.each(VARIANTS)("$name hedges the task_create mandate", ({ name, message }) => {
    //#given
    const lines = linesNamingTaskCreate(message)
    // A variant that never names the tool cannot break anything.
    expect(`${name}:${lines.length > 0}`).toBe(`${name}:true`)

    //#when
    const unhedged = lines.filter((line) => !/when the `task_create` tool exists/i.test(line))

    //#then
    // Every line naming the tool must condition on it existing. This is
    // per-line, not a single `includes` on the whole message, so a prompt can
    // never smuggle a second unconditional mandate in.
    expect(`${name}:${unhedged.length}`).toBe(`${name}:0`)
  })

  test.each(VARIANTS)("$name pins its fallback anchor when it ships one", ({ name, notepad }) => {
    //#given / #when / #then
    // null is an explicit "this variant ships no fallback block" record.
    if (notepad === null) {
      expect(`${name}:none`).toBe(`${name}:none`)
      return
    }
    const message = VARIANTS.find((variant) => variant.name === name)?.message ?? ""
    expect(`${name}:${notepad.test(message)}`).toBe(`${name}:true`)
  })

  test("the corpus is fully covered — a new variant cannot skip the fence", () => {
    //#given
    const expected = ["default", "deepseek", "gemini", "glm", "gpt5.2", "mimo"]
    const covered = VARIANTS.map((variant) => variant.name)

    //#when
    const missing = expected.filter((name) => !covered.includes(name))

    //#then
    expect(`missing:${missing.length}`).toBe("missing:0")
    expect(`covered:${covered.length}`).toBe("covered:6")
  })
})

/**
 * The agent set is produced by the real factories. Nothing here names an agent
 * to grant it anything: eligibility is read off each produced config's own
 * `mode`, and the grant comes from the same `applyToolConfig` the plugin runs.
 */
async function realAgentResult(): Promise<Record<string, unknown>> {
  const oracle = await buildOracleAgentConfig({
    configAgentPlan: undefined,
    pluginOracleOverride: undefined,
    userCategories: undefined,
    currentModel: MODEL,
  })
  return {
    morpheus: createMorpheusAgent(MODEL),
    keymaker: createKeymakerAgent(MODEL),
    cipher: createCipherAgent(MODEL),
    sentinel: createSentinelAgent(MODEL),
    oracle,
  }
}

function modeOf(agents: Record<string, unknown>, name: string): string {
  return ((agents[name] as { mode?: string })?.mode ?? "subagent") as string
}

function apply(agents: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  applyToolConfig({ config, pluginConfig: {} as MatrixxConfig, agentResult: agents })
  return config
}

describe("task-store eligibility is a function of mode", () => {
  test("mode in {primary, all} implies the task store, for every eligible agent", async () => {
    //#given
    const agents = await realAgentResult()
    const eligible = Object.keys(agents).filter((name) => {
      const mode = modeOf(agents, name)
      return mode === "primary" || mode === "all"
    })
    // Non-vacuous: the filter found the agents whose mode it read off configs.
    expect(`eligible:${eligible.length}`).not.toBe("eligible:0")

    //#when
    apply(agents)

    //#then
    for (const name of eligible) {
      const rules = ((agents[name] as { permissions?: Rule[] }).permissions ?? []) as Rule[]
      expect(`${name}:${rules.some((r) => r.action === "task_*" && r.effect === "allow")}`).toBe(`${name}:true`)
    }
  })

  test("an agent that denies delegation for itself keeps the task store", async () => {
    //#given
    // Sentinel is a read-only auditor: read-only covers files, and the task
    // store is the channel it hands findings over on. Its own declared
    // `task: "deny"` must survive the fill-only grant.
    const sentinel = createSentinelAgent(MODEL)
    const declared = (sentinel.permissions ?? []).filter((r) => r.action === "task")
    expect(`sentinel declares:${declared.map((r) => r.effect).join(",")}`).toBe("sentinel declares:deny")

    //#when
    const grant = deriveTaskPermissions(sentinel)

    //#then
    expect(`task_*:${grant.some((r) => r.action === "task_*" && r.effect === "allow")}`).toBe("task_*:true")
    // deriveTaskPermissions must not resurrect a self-denied capability.
    expect(`task:${grant.some((r) => r.action === "task" && r.effect === "allow")}`).toBe("task:false")
  })

  test("a bare subagent receives no task grant", async () => {
    //#given
    // Function-level contract on an input that declares nothing. This is NOT
    // the converse of the eligibility criterion: it says nothing about a
    // subagent that declares its own permissions (the documented Mouse
    // carve-out is untouched by it).
    const bare = { mode: "subagent" }

    //#when
    const permission = deriveTaskPermissions(bare)

    //#then
    expect(`keys:${Object.keys(permission).length}`).toBe("keys:0")
  })
})

describe("legacy todo tools stay suppressed", () => {
  test("denyTodoPermissions still denies both todo tools", () => {
    //#given / #when / #then
    // Denying these is what prevents the legacy tools from being used at all;
    // treating them as cleanup and removing them would be a regression.
    expect(`todowrite:${denyTodoPermissions.some((r) => r.action === "todowrite" && r.effect === "deny")}`).toBe("todowrite:true")
    expect(`todoread:${denyTodoPermissions.some((r) => r.action === "todoread" && r.effect === "deny")}`).toBe("todoread:true")
  })

  test("the built agent rulesets deny todowrite/todoread (V2 has no global tool map)", async () => {
    //#given
    const agents = await realAgentResult()

    //#when
    apply(agents)

    //#then every agent carries both denies
    for (const [name, value] of Object.entries(agents)) {
      const rules = ((value as { permissions?: Rule[] }).permissions ?? []) as Rule[]
      expect(`${name}:todowrite:${rules.some((r) => r.action === "todowrite" && r.effect === "deny")}`).toBe(`${name}:todowrite:true`)
      expect(`${name}:todoread:${rules.some((r) => r.action === "todoread" && r.effect === "deny")}`).toBe(`${name}:todoread:true`)
    }
  })
})
