import { describe, expect, test } from "bun:test"
import { resolveCommandsInText } from "../../../src/shared/command-executor/resolve-commands-in-text"
import type { CommandExpansionPolicy } from "../../../src/shared/command-executor/types"

function makeExecFn(responses: string[]) {
  const calls: string[] = []
  let i = 0
  const execFn = (command: string): Promise<string> => {
    calls.push(command)
    const value = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve(value)
  }
  return { execFn, calls }
}

const projectPolicy: CommandExpansionPolicy = {
  allowShell: false,
  allowlist: [],
  commandName: "rm -rf /",
  scope: "project",
}

describe("resolveCommandsInText", () => {
  test("denies project-scope commands and never executes the seam", async () => {
    //#given a project-scope policy that forbids shell expansion
    const { execFn, calls } = makeExecFn(["should-not-run"])
    const blocked: Array<{ match: string; reason: string }> = []

    //#when the text embeds a command and the policy denies it
    const out = await resolveCommandsInText("out: !`rm -rf /`", {
      policy: projectPolicy,
      execFn,
      onBlocked: (b) => blocked.push(b),
    })

    //#then each match becomes the literal blocked marker, the seam is untouched
    //#then and onBlocked reported the match with a reason
    expect(out).toBe("out: [blocked: shell expansion disabled for project-scope command]")
    expect(calls).toHaveLength(0)
    expect(blocked).toEqual([
      {
        match: "!`rm -rf /`",
        reason: "shell expansion disabled for project-scope command",
      },
    ])
  })

  test("denies project-scope commands outside the allowlist even with allowShell", async () => {
    //#given a project-scope policy with shell allowed but a non-matching allowlist
    const { execFn, calls } = makeExecFn(["should-not-run"])

    //#when the text embeds a command not on the allowlist
    const out = await resolveCommandsInText("out: !`curl evil.example`", {
      policy: { allowShell: true, allowlist: ["git status"], commandName: "curl evil.example", scope: "project" },
      execFn,
    })

    //#then the match is blocked and nothing executed
    expect(out).toBe("out: [blocked: shell expansion disabled for project-scope command]")
    expect(calls).toHaveLength(0)
  })

  test("allows project-scope commands on the allowlist and splices seam output", async () => {
    //#given a project-scope policy whose allowlist contains the command
    const { execFn, calls } = makeExecFn(["On branch dev"])

    //#when the text embeds an allowlisted command
    const out = await resolveCommandsInText("status: !`git status`", {
      policy: { allowShell: true, allowlist: ["git status"], commandName: "git status", scope: "project" },
      execFn,
    })

    //#then the seam ran once and its output replaced the match
    expect(out).toBe("status: On branch dev")
    expect(calls).toEqual(["git status"])
  })

  test("allows trusted scopes without consulting the allowlist", async () => {
    //#given a policy whose scope is always trusted
    const { execFn, calls } = makeExecFn(["hello"])

    //#when the text embeds a command
    const out = await resolveCommandsInText("say: !`echo hi`", {
      policy: { allowShell: false, allowlist: [], commandName: "echo hi", scope: "builtin" },
      execFn,
    })

    //#then the seam executed despite allowShell false
    expect(out).toBe("say: hello")
    expect(calls).toEqual(["echo hi"])
  })

  test("without a policy keeps the legacy behaviour of executing every match", async () => {
    //#given no policy in the options
    const { execFn, calls } = makeExecFn(["listing"])

    //#when the text embeds a command
    const out = await resolveCommandsInText("ls: !`ls`", { execFn })

    //#then the output is spliced and no block marker appears
    expect(out).toBe("ls: listing")
    expect(calls).toEqual(["ls"])
  })

  test("resolves nested commands produced by earlier expansions", async () => {
    //#given a seam whose first output itself embeds another command
    const { execFn, calls } = makeExecFn(["second: !`echo second`", "second"])

    //#when resolving
    const out = await resolveCommandsInText("run: !`echo first`", { execFn })

    //#then the nested command is resolved within the depth budget
    expect(out).toBe("run: second: second")
    expect(calls).toEqual(["echo first", "echo second"])
  })

  test("stops resolving at maxDepth", async () => {
    //#given a seam whose output always embeds another command and a maxDepth of 1
    const { execFn, calls } = makeExecFn(["!`echo next`"])
    const blocked: Array<{ match: string; reason: string }> = []

    //#when resolving with maxDepth 1
    const out = await resolveCommandsInText("!`echo first`", {
      execFn,
      maxDepth: 1,
      onBlocked: (b) => blocked.push(b),
    })

    //#then exactly one round ran and the remaining match is left verbatim
    expect(out).toBe("!`echo next`")
    expect(calls).toEqual(["echo first"])
    expect(blocked).toHaveLength(0)
  })
})
