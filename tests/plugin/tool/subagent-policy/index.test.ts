/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { applySubagentPolicy } from "../../../../src/plugin/tool/subagent-policy/index"

function inputFor(tool: string) {
  return { tool, sessionID: "ses_parent", callID: "call_1" }
}

describe("applySubagentPolicy orchestration", () => {
  test("non-subagent tools pass through untouched", () => {
    //#given
    const input = inputFor("bash")
    const output = { args: { command: "ls", load_skills: ["tdd-enforcer"] } as Record<string, unknown> }

    //#when
    applySubagentPolicy(input, output)

    //#then
    expect(output.args).toEqual({ command: "ls", load_skills: ["tdd-enforcer"] })
  })

  test("skill-less subagent call leaves prompt byte-identical", () => {
    //#given
    const prompt = "Summarize the quarterly report highlights."
    const input = inputFor("subagent")
    const output = {
      args: { agent: "mouse-transmission", description: "d", prompt } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(input, output, {
      skillResolver: () => {
        throw new Error("must not be called without skills")
      },
    })

    //#then
    expect(output.args.prompt).toBe(prompt)
    expect(output.args.prompt).toBe("Summarize the quarterly report highlights.")
  })

  test("extra load_skills key survives core strip and is consumed", () => {
    //#given
    const stripLikeCore = (event: { tool: string; input: Record<string, unknown> }) => {
      if (event.tool !== "subagent") return
      if (event.input.model !== "" && event.input.sessionID !== "") return
      const next = { ...event.input }
      if (next.model === "") delete next.model
      if (next.sessionID === "") delete next.sessionID
      event.input = next
    }
    const event = {
      tool: "subagent",
      input: {
        agent: "mouse-transmission",
        description: "d",
        prompt: "Summarize the highlights.",
        model: "",
        sessionID: "",
        load_skills: ["tdd-enforcer"],
      } as Record<string, unknown>,
    }

    //#when
    stripLikeCore(event)
    applySubagentPolicy(inputFor(event.tool), { args: event.input }, {
      skillResolver: (skills: string[]) => ({
        content: `resolved:${skills.join(",")}`,
        error: null,
      }),
    })

    //#then
    expect(event.input.prompt).toBe("resolved:tdd-enforcer\n\nSummarize the highlights.")
    expect(event.input).not.toHaveProperty("load_skills")
  })

  test("unknown skill surfaces as thrown error", () => {
    //#given
    const input = inputFor("subagent")
    const output = {
      args: {
        agent: "mouse-source",
        description: "d",
        prompt: "do it",
        load_skills: ["ghost-skill"],
      } as Record<string, unknown>,
    }

    //#when / #then
    expect(() =>
      applySubagentPolicy(input, output, {
        skillResolver: (skills: string[]) => ({
          content: undefined,
          error: `Skills not found: ${skills.join(",")}`,
        }),
      }),
    ).toThrow("ghost-skill")
  })

  test("strips background affordances before execution and logs each key", () => {
    //#given
    const logged: Array<{ message: string; data?: unknown }> = []
    const input = inputFor("subagent")
    const output = {
      args: {
        agent: "mouse-transmission",
        description: "d",
        prompt: "do it",
        sessionID: "ses_child",
        model: "provider/model",
        background: true,
        run_in_background: false,
        load_skills: ["tdd-enforcer"],
        complexity: 1,
      } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(input, output, {
      skillResolver: (skills: string[]) => ({
        content: `resolved:${skills.join(",")}`,
        error: null,
      }),
      log: (message: string, data?: unknown) => logged.push({ message, data }),
    })

    //#then
    expect(output.args).not.toHaveProperty("background")
    expect(output.args).not.toHaveProperty("run_in_background")
    expect(output.args).not.toHaveProperty("load_skills")
    expect(output.args).not.toHaveProperty("complexity")
    expect(output.args).toEqual({
      agent: "mouse-transmission",
      description: "d",
      prompt: "resolved:tdd-enforcer\n\ndo it",
      sessionID: "ses_child",
      model: "provider/model",
    })
    expect(logged.map((entry) => entry.data)).toEqual([{ key: "background" }, { key: "run_in_background" }])
    expect(logged.every((entry) => entry.message === "[subagent-policy] stripped background affordance")).toBe(true)
  })

  test("non-subagent call keeps background keys untouched", () => {
    //#given
    const logged: string[] = []
    const input = inputFor("bash")
    const output = {
      args: { command: "ls", background: true, run_in_background: true } as Record<string, unknown>,
    }

    //#when
    applySubagentPolicy(input, output, { log: (message: string) => logged.push(message) })

    //#then
    expect(output.args).toEqual({ command: "ls", background: true, run_in_background: true })
    expect(logged).toEqual([])
  })
})
