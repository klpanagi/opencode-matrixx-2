/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import type { MatrixxConfig } from "../../../src/config"
import { SOFTWARE_DEV_ENFORCEMENT_MARKER } from "../../../src/hooks/software-dev-enforcement/constants"
import { createSoftwareDevEnforcementHook } from "../../../src/hooks/software-dev-enforcement/hook"

function makeHook(pluginConfig?: MatrixxConfig) {
  return createSoftwareDevEnforcementHook(pluginConfig)["tool.execute.before"]
}

async function run(
  tool: string,
  args: Record<string, unknown>,
  pluginConfig?: MatrixxConfig,
) {
  const handler = makeHook(pluginConfig)
  const output = { args } as unknown as { args: Record<string, unknown>; message?: string }
  await handler({ tool, sessionID: "ses_1", callID: "c1" } as never, output as never)
  return output
}

describe("software-dev-enforcement subagent guard: orchestrator targets", () => {
  test("morpheus native subagent gets the FULL software-dev template prepended", async () => {
    //#given a native subagent call targeting an orchestrator with a plain prompt
    //#when the guard runs
    const output = await run("subagent", { agent: "morpheus", prompt: "plan the work" })

    //#then the full template is prepended once inside a system-reminder wrapper
    const prompt = String(output.args.prompt)
    expect(prompt).toContain("<system-reminder>")
    expect(prompt).toContain(SOFTWARE_DEV_ENFORCEMENT_MARKER)
    expect(prompt).toContain("TEAM ROLES")
    expect(prompt.endsWith("plan the work")).toBe(true)
  })

  test("keymaker/niobe/oracle targets resolve via the config orchestrators list", async () => {
    //#given native subagent calls targeting each default orchestrator
    //#when the guard runs on each
    for (const agent of ["keymaker", "niobe", "oracle"]) {
      const output = await run("subagent", { agent, prompt: "do planning" })

      //#then each receives the full template prepend
      expect(String(output.args.prompt)).toContain("TEAM ROLES")
    }
  })

  test("custom orchestrators list redefines the full-template set", async () => {
    //#given a config that narrows orchestrators to oracle only
    const config = { softwareDevEnforcement: { orchestrators: ["oracle"] } } as MatrixxConfig

    //#when a non-listed vs listed agent is dispatched
    const skipped = await run("subagent", { agent: "morpheus", prompt: "plan the work" }, config)
    const injected = await run("subagent", { agent: "oracle", prompt: "plan the work" }, config)

    //#then only the listed agent receives the template
    expect(String(skipped.args.prompt)).toBe("plan the work")
    expect(String(injected.args.prompt)).toContain("TEAM ROLES")
  })

  test("deprecated subagent_type alias resolves the target when agent is absent", async () => {
    //#given a native subagent call using the deprecated alias field
    //#when the guard runs
    const output = await run("subagent", { subagent_type: "oracle", prompt: "plan the work" })

    //#then the orchestrator template is prepended
    expect(String(output.args.prompt)).toContain("TEAM ROLES")
  })
})

describe("software-dev-enforcement subagent guard: executor targets", () => {
  test("mouse with a clearly code-writing prompt gets the executor subset notice", async () => {
    //#given a Mouse delegation whose prompt clearly delegates code-writing
    //#when the guard runs
    const output = await run("subagent", {
      agent: "mouse",
      prompt: "implement the login feature with tests",
    })

    //#then the tdd-enforcer/git-master subset is prepended, never the full template
    const prompt = String(output.args.prompt)
    expect(prompt).toContain(SOFTWARE_DEV_ENFORCEMENT_MARKER)
    expect(prompt).not.toContain("TEAM ROLES")
    expect(prompt.endsWith("implement the login feature with tests")).toBe(true)
  })

  test("mouse with a non-code-writing prompt is skipped (minimal scope)", async () => {
    //#given a Mouse delegation with no code-writing signal in the prompt
    //#when the guard runs
    const output = await run("subagent", {
      agent: "mouse",
      prompt: "summarize the meeting notes",
    })

    //#then the prompt is left untouched
    expect(output.args.prompt).toBe("summarize the meeting notes")
  })

  test("sati with a clearly code-writing prompt gets the executor subset notice", async () => {
    //#given a Sati delegation whose prompt clearly delegates code-writing
    //#when the guard runs
    const output = await run("subagent", {
      agent: "sati",
      prompt: "write a failing test then refactor the parser",
    })

    //#then the subset is prepended, never the full template
    const prompt = String(output.args.prompt)
    expect(prompt).toContain(SOFTWARE_DEV_ENFORCEMENT_MARKER)
    expect(prompt).not.toContain("TEAM ROLES")
  })

  test("sati with a non-code-writing prompt is skipped", async () => {
    //#given a Sati delegation with no code-writing signal in the prompt
    //#when the guard runs
    const output = await run("subagent", { agent: "sati", prompt: "review the design doc" })

    //#then the prompt is left untouched
    expect(output.args.prompt).toBe("review the design doc")
  })
})

describe("software-dev-enforcement subagent guard: exemptions", () => {
  test("read-only agents are always exempt", async () => {
    //#given native subagent calls targeting read-only agents
    //#when the guard runs on each
    for (const agent of ["trinity", "explore", "operator"]) {
      const output = await run("subagent", {
        agent,
        prompt: "implement the login feature with tests",
      })

      //#then the prompt is left untouched even for code-writing text
      expect(output.args.prompt).toBe("implement the login feature with tests")
    }
  })

  test("empty or undefined agent is skipped (minimal scope)", async () => {
    //#given native subagent calls with no usable target
    //#when the guard runs
    const empty = await run("subagent", { agent: "", prompt: "implement the thing" })
    const missing = await run("subagent", { prompt: "implement the thing" })

    //#then both prompts are left untouched
    expect(empty.args.prompt).toBe("implement the thing")
    expect(missing.args.prompt).toBe("implement the thing")
  })

  test("non-subagent tools are ignored", async () => {
    //#given a delegate-task style tool call targeting an orchestrator
    //#when the guard runs
    const output = await run("task", { agent: "morpheus", prompt: "plan the work" })

    //#then the prompt is left untouched (delegate-task owns that path)
    expect(output.args.prompt).toBe("plan the work")
  })

  test("enabled=false exempts everything absent explicit disabled entries", async () => {
    //#given the master kill-switch with no explicit disabled entries
    const config = { softwareDevEnforcement: { enabled: false }, tdd_enforcer: { enabled: true } } as unknown as MatrixxConfig

    //#when orchestrator and code-writing executor calls run
    const orch = await run("subagent", { agent: "morpheus", prompt: "plan the work" }, config)
    const exec = await run(
      "subagent",
      { agent: "mouse", prompt: "implement the login feature" },
      config,
    )

    //#then both prompts are left untouched
    expect(orch.args.prompt).toBe("plan the work")
    expect(exec.args.prompt).toBe("implement the login feature")
  })

  test("idempotency marker prevents double-injection on continuation re-prompts", async () => {
    //#given a prompt that already carries a previous injection
    const handler = makeHook()
    const first = await run("subagent", { agent: "morpheus", prompt: "plan the work" })
    const secondArgs = { agent: "morpheus", prompt: first.args.prompt }
    const second = { args: secondArgs } as unknown as {
      args: Record<string, unknown>
      message?: string
    }

    //#when the guard runs again on the already-injected prompt
    await handler({ tool: "subagent", sessionID: "ses_1", callID: "c2" } as never, second as never)

    //#then the prompt is byte-identical (no double-inject)
    expect(second.args.prompt).toBe(first.args.prompt)
    expect(String(second.args.prompt).split(SOFTWARE_DEV_ENFORCEMENT_MARKER).length).toBe(2)
  })
})

describe("software-dev-enforcement subagent guard: fail-closed precedence", () => {
  test("blocked software-dev skill appends an error NOTICE, never throws", async () => {
    //#given an orchestrator delegation with software-dev explicitly disabled
    const config = {
      disabled_skills: ["software-dev"],
    } as unknown as MatrixxConfig

    //#when the guard runs
    const output = await run("subagent", { agent: "oracle", prompt: "plan the work" }, config)

    //#then the error notice is appended inside the wrapper and the call resolves
    const prompt = String(output.args.prompt)
    expect(prompt).toContain(SOFTWARE_DEV_ENFORCEMENT_MARKER)
    expect(prompt).toContain("disabled_skills")
    expect(prompt).toContain("software-dev")
    expect(prompt).not.toContain("TEAM ROLES")
  })

  test("blocked subset skill on code-writing mouse appends a notice, never throws", async () => {
    //#given a code-writing Mouse delegation with tdd-enforcer explicitly disabled
    const config = {
      disabled_skills: ["tdd-enforcer"],
    } as unknown as MatrixxConfig

    //#when the guard runs
    const output = await run(
      "subagent",
      { agent: "mouse", prompt: "implement the login feature" },
      config,
    )

    //#then the disabled-skill notice is appended and the call resolves
    const prompt = String(output.args.prompt)
    expect(prompt).toContain("tdd-enforcer")
    expect(prompt).toContain("disabled_skills")
  })

  test("blocked-skill notice wins even with enabled=false", async () => {
    //#given the master kill-switch plus an explicit disabled entry
    const config = {
      softwareDevEnforcement: { enabled: false },
      disabled_skills: ["software-dev"],
    } as unknown as MatrixxConfig

    //#when the guard runs
    const output = await run("subagent", { agent: "oracle", prompt: "plan the work" }, config)

    //#then the notice is still appended (explicit entries are never silent)
    expect(String(output.args.prompt)).toContain("disabled_skills")
  })

  test("autoAppend mode appends the subset without a missing-skill notice", async () => {
    //#given autoAppend mode with no disabled entries
    const config = {
      softwareDevEnforcement: { mode: "autoAppend" },
      tdd_enforcer: { enabled: true } as unknown as MatrixxConfig["tdd_enforcer"],
    } as unknown as MatrixxConfig

    //#when a code-writing Mouse delegation runs
    const output = await run(
      "subagent",
      { agent: "mouse", prompt: "implement the login feature" },
      config,
    )

    //#then subset content is prepended with no error text
    const prompt = String(output.args.prompt)
    expect(prompt).toContain(SOFTWARE_DEV_ENFORCEMENT_MARKER)
    expect(prompt).not.toContain("disabled_skills")
  })

  test("autoAppend mode never suppresses a blocked-skill notice", async () => {
    //#given autoAppend mode plus an explicit disabled entry
    const config = {
      softwareDevEnforcement: { mode: "autoAppend" },
      disabled_skills: ["tdd-enforcer"],
    } as unknown as MatrixxConfig

    //#when a code-writing Mouse delegation runs
    const output = await run(
      "subagent",
      { agent: "mouse", prompt: "implement the login feature" },
      config,
    )

    //#then the blocked-skill notice is still appended
    const prompt = String(output.args.prompt)
    expect(prompt).toContain("tdd-enforcer")
    expect(prompt).toContain("disabled_skills")
  })

  test("malformed input never throws (append-only, fail-open)", async () => {
    //#given calls with missing or non-string prompts
    const handler = makeHook()

    //#when the guard runs on each
    const noPrompt = { args: { agent: "morpheus" } } as unknown as {
      args: Record<string, unknown>
      message?: string
    }
    const nullPrompt = { args: { agent: "morpheus", prompt: null } } as unknown as {
      args: Record<string, unknown>
      message?: string
    }

    //#then both resolve without throwing and leave args untouched
    await handler({ tool: "subagent", sessionID: "ses_1", callID: "c1" } as never, noPrompt as never)
    await handler({ tool: "subagent", sessionID: "ses_1", callID: "c2" } as never, nullPrompt as never)
    expect(noPrompt.args.prompt).toBeUndefined()
    expect(nullPrompt.args.prompt).toBeNull()
  })
})

