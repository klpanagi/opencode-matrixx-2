/// <reference types="bun-types" />

/**
 * Guardrail: the legacy todo tools must stay denied for every agent
 * UNCONDITIONALLY (invariant I1).
 *
 * V2 expresses gating as per-agent `{action, resource, effect}` rulesets —
 * there is no global `config.tools` map. `applyToolConfig` seeds the
 * baseline deny (`denyTodoPermissions`) for every agent, so no
 * tasks.enabled branch or per-agent override can ever allow them.
 *
 * CI note: this file lives under `tests/plugin-handlers/`, which is a
 * **directory** entry in `script/mock-heavy-list.txt`, so it runs isolated and
 * `mock.module()` would be permitted. It is not needed — the handler is pure.
 */

import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import type { MatrixxConfig } from "../../src/config/schema"
import { applyToolConfig } from "../../src/plugin-handlers/tool-config-handler"

const SRC = path.join(import.meta.dir, "../../src")
const HANDLER = path.join(SRC, "plugin-handlers/tool-config-handler.ts")

type Rule = { action: string; resource?: string; effect: string }

/** Agent keys the handler grants explicit overrides for. */
const AGENT_KEYS = ["operator", "trinity", "construct", "architect", "morpheus", "keymaker", "oracle", "mouse"] as const

function run(pluginConfig: unknown, seedAgents?: Record<string, unknown>) {
  const config: Record<string, unknown> = {}
  const agentResult: Record<string, unknown> =
    seedAgents ?? Object.fromEntries(AGENT_KEYS.map((key) => [key, {}]))
  applyToolConfig({
    config,
    pluginConfig: pluginConfig as MatrixxConfig,
    agentResult,
  })
  return { config, agentResult }
}

function rulesOf(agentResult: Record<string, unknown>, name: string): Rule[] {
  return ((agentResult[name] as { permissions?: Rule[] })?.permissions ?? []) as Rule[]
}

describe("todo tools are unconditionally suppressed (I1)", () => {
  test("tasks.enabled true, false and absent all yield todo denies", () => {
    //#given tasks.enabled true, false, and absent
    const enabled = run({ tasks: { enabled: true, scope: "project" } })
    const disabled = run({ tasks: { enabled: false, scope: "project" } })
    const absent = run({})

    //#then every agent denies both todo tools in all three cases
    for (const result of [enabled, disabled, absent]) {
      for (const name of AGENT_KEYS) {
        const rules = rulesOf(result.agentResult, name)
        for (const action of ["todowrite", "todoread"]) {
          expect(rules.some((r) => r.action === action && r.effect === "deny")).toBe(true)
          expect(rules.some((r) => r.action === action && r.effect === "allow")).toBe(false)
        }
      }
    }
  })

  test("the resulting rulesets are identical across all three cases", () => {
    //#given the same three configurations
    const enabled = run({ tasks: { enabled: true, scope: "project" } })
    const disabled = run({ tasks: { enabled: false, scope: "project" } })
    const absent = run({})

    //#then no branch can differ — the task-system key no longer reaches the handler
    for (const name of AGENT_KEYS) {
      expect(rulesOf(disabled.agentResult, name)).toEqual(rulesOf(enabled.agentResult, name))
      expect(rulesOf(absent.agentResult, name)).toEqual(rulesOf(enabled.agentResult, name))
    }
  })
})

describe("no agent branch ever allows todo tools", () => {
  test("no per-agent ruleset grants todowrite/todoread", () => {
    //#given the default agent set
    const { agentResult } = run({ tasks: { enabled: true, scope: "project" } })
    const offenders: string[] = []

    //#then every agent todo rule is deny (never allow)
    for (const [name, value] of Object.entries(agentResult)) {
      const rules = ((value as { permissions?: Rule[] })?.permissions ?? []) as Rule[]
      for (const r of rules) {
        if ((r.action === "todowrite" || r.action === "todoread") && r.effect === "allow") {
          offenders.push(`${name}.${r.action}=${r.effect}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test("every todo rule in the handler source is a deny", () => {
    //#given the handler source plus the permission module it imports denies from
    const handlerSource = fs.readFileSync(HANDLER, "utf-8")
    const permsSource = fs.readFileSync(path.join(SRC, "plugin-handlers/task-permissions.ts"), "utf-8")
    const source = handlerSource + permsSource
    const matches = source.match(/rule\("(?:todowrite|todoread)",\s*"[^"]*"\)/g) ?? []

    //#then only deny effects appear
    expect(matches.length).toBeGreaterThan(0)
    for (const match of matches) {
      expect(match).toMatch(/"deny"\)$/)
    }
  })
})

describe("plugin config wins over a hand-set user override", () => {
  test("a user todo allow in config.tools is untouched by the handler (V2 has no global tool map)", () => {
    //#given a user opencode.json with tools: { todowrite: true, todoread: true }
    const config: Record<string, unknown> = { tools: { todowrite: true, todoread: true } }
    const agentResult: Record<string, unknown> = Object.fromEntries(AGENT_KEYS.map((key) => [key, {}]))

    //#when applyToolConfig runs (it only rewrites per-agent rulesets)
    applyToolConfig({ config, pluginConfig: {} as MatrixxConfig, agentResult })

    //#then the handler leaves config.tools alone; per-agent denies still hold
    expect(config.tools).toEqual({ todowrite: true, todoread: true })
    for (const name of AGENT_KEYS) {
      const rules = rulesOf(agentResult, name)
      expect(rules.some((r) => r.action === "todowrite" && r.effect === "deny")).toBe(true)
    }
  })

  test("a user per-agent todo allow survives alongside the baseline deny (last-match-wins)", () => {
    //#given a hand-set per-agent allow (fill-only baseline never restates declared actions)
    const seedAgents: Record<string, unknown> = Object.fromEntries(
      AGENT_KEYS.map((key) => [key, { permissions: [{ action: "todowrite", resource: "*", effect: "allow" }] }]),
    )

    //#when
    const { agentResult } = run({ tasks: { enabled: true } }, seedAgents)

    //#then the declared allow is kept and no duplicate deny shadows it
    for (const name of AGENT_KEYS) {
      const rules = rulesOf(agentResult, name)
      const allows = rules.filter((r) => r.action === "todowrite" && r.effect === "allow")
      expect(allows.length).toBe(1)
    }
  })
})

describe("every agent arm denies the todo tools", () => {
  test("the source file grants overrides for exactly the agents the test enumerates", () => {
    //#given the handler source
    const source = fs.readFileSync(HANDLER, "utf-8")

    //#then the override keys found in the source match the literal list
    const found = [...source.matchAll(/^\s{4}(operator|trinity|construct|architect|morpheus|keymaker|oracle|mouse):/gm)].map((m) => m[1])
    expect(found.sort()).toEqual([...AGENT_KEYS].sort())
  })

  test("each override agent denies todowrite and todoread via baseline", () => {
    //#given the full agent set
    const { agentResult } = run({ tasks: { enabled: true, scope: "project" } })

    //#then every override agent carries an explicit deny for both keys
    for (const name of AGENT_KEYS) {
      const rules = rulesOf(agentResult, name)
      expect(rules.some((r) => r.action === "todowrite" && r.effect === "deny")).toBe(true)
      expect(rules.some((r) => r.action === "todoread" && r.effect === "deny")).toBe(true)
    }
  })

  test("agents without an explicit override arm still get the baseline denies", () => {
    //#given an agent the override map does not name
    const { agentResult } = run({}, { sentinel: {} })

    //#then the baseline still denies both todo tools
    const rules = rulesOf(agentResult, "sentinel")
    expect(rules.some((r) => r.action === "todowrite" && r.effect === "deny")).toBe(true)
    expect(rules.some((r) => r.action === "todoread" && r.effect === "deny")).toBe(true)
  })
})
