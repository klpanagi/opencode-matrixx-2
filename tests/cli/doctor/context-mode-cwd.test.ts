/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { evaluateContextModeCwd } from "../../../src/cli/doctor/checks/context-mode"

describe("evaluateContextModeCwd", () => {
  test("passes when no context-mode MCP server is registered", () => {
    //#given: no server entry
    //#when: evaluated
    const got = evaluateContextModeCwd(undefined)
    //#then: pass — the integration check owns the not-registered case
    expect(got.status).toBe("pass")
  })

  test("warns when the server is registered without an explicit cwd", () => {
    //#given: a process-global server entry with no cwd pin
    //#when: evaluated
    const got = evaluateContextModeCwd({ command: "npx", args: ["-y", "context-mode"] })
    //#then: warn naming the spawn-cwd inheritance + per-project fix
    expect(got.status).toBe("warn")
    expect(got.detail).toContain("spawn cwd")
    expect(got.detail).toContain(".opencode/opencode.json")
  })

  test("warns when cwd is an empty string", () => {
    //#given: a server entry with a blank cwd
    //#when: evaluated
    const got = evaluateContextModeCwd({ command: "npx", cwd: "  " })
    //#then: warn — blank is the same as unset
    expect(got.status).toBe("warn")
  })

  test("passes when the server pins an explicit cwd", () => {
    //#given: a server entry with cwd set
    //#when: evaluated
    const got = evaluateContextModeCwd({ command: "npx", cwd: "/home/user/proj" })
    //#then: pass
    expect(got.status).toBe("pass")
  })

  test("passes for non-object entries", () => {
    //#given: a malformed server entry
    //#when: evaluated
    const got = evaluateContextModeCwd("context-mode")
    //#then: pass (fail-open — registration shape is the integration check's job)
    expect(got.status).toBe("pass")
  })
})
