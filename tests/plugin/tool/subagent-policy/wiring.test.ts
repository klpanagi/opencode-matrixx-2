/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../../../../src/config"
import { applySubagentPolicy } from "../../../../src/plugin/tool/subagent-policy/index"
import { buildSubagentPolicyDeps } from "../../../../src/plugin/tool/subagent-policy/wiring"

function configWith(overrides: Record<string, unknown>): MatrixxConfig {
  return {
    agents: {
      "mouse-source": { model: "orig/model" },
      "mouse-bullet-time": { model: "orig/model" },
    },
    categories: {
      source: { complexity_downgrades: { "1": "cheap/model", "2": "cheap/model" } },
    },
    ...overrides,
  } as unknown as MatrixxConfig
}

function subagentInput() {
  return { tool: "subagent", sessionID: "ses_parent", callID: "call_1" }
}

describe("wired subagent policy (production deps)", () => {
  test("explicit model downgraded on trivial prompt", () => {
    //#given
    const deps = buildSubagentPolicyDeps(configWith({}))
    const output = {
      args: {
        agent: "mouse-source",
        description: "fix typo",
        prompt: "fix typo in src/foo.ts",
        model: "orig/model",
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(subagentInput(), output, deps)

    //#then
    expect(output.args.model).toBe("cheap/model")
  })

  test("absent model resolves agent default then downgrades", () => {
    //#given
    const deps = buildSubagentPolicyDeps(configWith({}))
    const output = {
      args: {
        agent: "mouse-bullet-time",
        description: "fix typo",
        prompt: "fix typo",
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(subagentInput(), output, {
      ...deps,
      complexity: {
        ...deps.complexity,
        downgrades: { "bullet-time": { "1": "cheap/model" } },
      },
    })

    //#then
    expect(output.args.model).toBe("cheap/model")
  })

  test("complex prompt is never rewritten", () => {
    //#given
    const deps = buildSubagentPolicyDeps(configWith({}))
    const output = {
      args: {
        agent: "mouse-source",
        description: "redesign architecture",
        prompt: "redesign system-wide architecture across platform modules",
        model: "orig/model",
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(subagentInput(), output, deps)

    //#then
    expect(output.args.model).toBe("orig/model")
  })

  test("continuation is never rewritten", () => {
    //#given
    const deps = buildSubagentPolicyDeps(configWith({}))
    const output = {
      args: {
        agent: "mouse-source",
        description: "fix typo",
        prompt: "fix typo",
        model: "orig/model",
        sessionID: "ses_abc123",
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(subagentInput(), output, deps)

    //#then
    expect(output.args.model).toBe("orig/model")
  })

  test("global complexityDowngrades map applies when no per-category entry", () => {
    //#given
    const deps = buildSubagentPolicyDeps(
      configWith({
        categories: {},
        complexityDowngrades: { source: { "1": "global-cheap/model" } },
      }),
    )
    const output = {
      args: {
        agent: "mouse-source",
        description: "fix typo",
        prompt: "fix typo",
        model: "orig/model",
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(subagentInput(), output, deps)

    //#then
    expect(output.args.model).toBe("global-cheap/model")
  })
})
